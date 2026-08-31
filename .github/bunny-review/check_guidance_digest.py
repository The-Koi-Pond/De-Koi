import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from types import SimpleNamespace


sys.dont_write_bytecode = True

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / ".github" / "bunny-review" / "bunny_review.py"


def load_bunny_review():
    spec = importlib.util.spec_from_file_location("bunny_review_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_git(root, *args):
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed:\n{result.stdout}{result.stderr}")
    return result.stdout


def write_packet_repo(root):
    (root / "AGENTS.md").write_text("# Repo Instructions\n\nUse changed-line findings.\n", encoding="utf-8")
    tool_dir = root / ".github" / "bunny-review"
    tool_dir.mkdir(parents=True)
    (tool_dir / "reviewer-prompt.md").write_text("prompt", encoding="utf-8")
    (tool_dir / "rules.json").write_text(
        json.dumps(
            {
                "path_instructions": [
                    {
                        "prefixes": ["src/"],
                        "guidance": ["skills/example/SKILL.md"],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    skill = root / "skills" / "example" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# Example\n\nSelected path guidance.\n", encoding="utf-8")

    src = root / "src"
    src.mkdir()
    (src / "example.ts").write_text("export const originalValue = 1;\n", encoding="utf-8")
    (src / "second.ts").write_text("export const secondOriginal = 1;\n", encoding="utf-8")
    run_git(root, "init", "-q")
    run_git(root, "config", "user.email", "bunny@example.invalid")
    run_git(root, "config", "user.name", "Bunny Proof")
    run_git(root, "add", ".")
    run_git(root, "commit", "-q", "-m", "base")
    (src / "example.ts").write_text("export const changedValue = 2;\n", encoding="utf-8")
    (src / "second.ts").write_text("export const secondChanged = 2;\n", encoding="utf-8")
    run_git(root, "add", ".")
    run_git(root, "commit", "-q", "-m", "head")
    return tool_dir


def section(packet, title):
    marker = f"## {title}\n"
    start = packet.index(marker) + len(marker)
    next_start = packet.find("\n\n## ", start)
    if next_start == -1:
        return packet[start:]
    return packet[start:next_start]


def run_packet_case(module):
    with tempfile.TemporaryDirectory(prefix="bunny-packet-proof-") as tmp:
        root = pathlib.Path(tmp)
        tool_dir = write_packet_repo(root)
        module.REPO_ROOT = root
        os.environ["BUNNY_REVIEW_PROMPT_PATH"] = str(tool_dir / "reviewer-prompt.md")

        packet = module.build_review_packet("HEAD~1", "", "full")
        overview = section(packet, "patch overview")
        per_file = section(packet, "per-file patch context")

        assert "Raw patch is not repeated here" in overview
        assert "diff --git" not in overview
        assert "changedValue" in per_file
        assert "guidance: AGENTS.md" in packet
        assert "guidance: skills/example/SKILL.md" in packet
        changed = module.changed_files("HEAD~1")
        old_threshold = module.MAX_CHUNK_PATCH_CHARS
        try:
            module.MAX_CHUNK_PATCH_CHARS = 1
            raw_chunks = module.chunk_changed_files("HEAD~1", changed)
            _, planned_chunks = module.review_chunks_for_packet_budget("HEAD~1", "", "full", changed)
        finally:
            module.MAX_CHUNK_PATCH_CHARS = old_threshold
        assert len(raw_chunks) > 1, "forced raw patch chunking did not split the fixture"
        assert planned_chunks == [changed], "full packet under budget should not be chunked"
        review_obj = module.normalize_review_object(
            {"findings": [], "nitpicks": [], "pre_merge_checks": []},
            "HEAD~1",
            changed,
        )
        assert review_obj["change_summary"], "missing model summary should get a fallback"
        rendered = module.render_walkthrough(
            review_obj,
            [],
            [],
            [],
            "",
            "0" * 40,
        )
        assert "### 🧭 Loot Summary" in rendered
        assert "No loot summary produced" not in rendered
        assert "Specimen" not in rendered
        assert "### 🔎 Bad Machinery" in rendered
        return len(packet)


def run_semantic_repair_case(module):
    incomplete = {
        "findings": [],
        "nitpicks": [],
        "pre_merge_checks": [],
        "open_questions": [],
        "what_i_checked": [],
    }
    repaired = {
        "change_summary": [
            "Wah, the repair pass restored the missing summary so the review contract has real loot on the table."
        ],
        "findings": [],
        "nitpicks": [],
        "pre_merge_checks": [],
        "open_questions": [],
        "what_i_checked": [
            "Aha, Bunny checked the review packet and repaired the schema gap."
        ],
    }

    class FakeCompletions:
        def __init__(self):
            self.calls = []

        def create(self, **kwargs):
            self.calls.append(kwargs)
            return SimpleNamespace(
                usage=None,
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content="FINAL_REVIEW\n" + json.dumps(repaired)
                        )
                    )
                ],
            )

    completions = FakeCompletions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    stats = module.build_stats("packet")
    parsed = module.extract_json_or_repair(
        client,
        [{"role": "system", "content": "prompt"}, {"role": "user", "content": "packet"}],
        "FINAL_REVIEW\n" + json.dumps(incomplete),
        stats,
    )

    assert len(completions.calls) == 1, "semantic schema gap should trigger one repair call"
    assert parsed["change_summary"] == repaired["change_summary"]
    assert parsed["_schema_repair_gaps"], "repair diagnostics should be retained"
    normalized = module.normalize_review_object(parsed, "HEAD~1", ["src/example.ts"])
    assert normalized["what_i_checked"][0].startswith("Bunny repaired the model review JSON")
    return stats["model_calls"]


def valid_review(label):
    return {
        "change_summary": [f"Reviewed {label}."],
        "findings": [],
        "nitpicks": [],
        "pre_merge_checks": [],
        "open_questions": [],
        "what_i_checked": [f"Checked {label}."],
    }


class ChunkReviewCompletions:
    def __init__(self, *, fail_once=None, fail_always=None, invalid_then_valid=None):
        self.calls = []
        self.fail_once = fail_once
        self.fail_always = fail_always
        self.invalid_then_valid = invalid_then_valid
        self.chunk_attempts = {}

    def create(self, **kwargs):
        self.calls.append(kwargs)
        prompt = "\n".join(message["content"] for message in kwargs["messages"])
        if "# Chunk Review Results" in prompt:
            payload = valid_review("final judge")
        else:
            chunk_index = next(
                index
                for index in range(1, 9)
                if f"BUNNY_CHUNK_PACKET_{index}" in prompt
            )
            self.chunk_attempts[chunk_index] = self.chunk_attempts.get(chunk_index, 0) + 1
            if chunk_index == self.fail_always:
                raise TimeoutError("scripted exhausted chunk timeout")
            if chunk_index == self.fail_once and self.chunk_attempts[chunk_index] == 1:
                raise TimeoutError("scripted transient chunk timeout")
            if chunk_index == self.invalid_then_valid and self.chunk_attempts[chunk_index] <= 2:
                payload = {"findings": []}
            else:
                payload = valid_review(f"chunk {chunk_index}")
        return SimpleNamespace(
            usage=None,
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="FINAL_REVIEW\n" + json.dumps(payload)
                    )
                )
            ],
        )


def chunk_inputs():
    return [
        {
            "index": index,
            "count": 8,
            "focus_files": [f"src/chunk-{index}.ts"],
            "packet_chars": 1000 + index,
            "triage_content": (
                f"BUNNY_CHUNK_PACKET_{index}\n"
                f"PRIVATE_PACKET_TEXT_{index}"
            ),
        }
        for index in range(1, 9)
    ]


def run_chunk_orchestration_case(module):
    review_context = "PR metadata without raw patch text"

    normal_completions = ChunkReviewCompletions()
    normal_client = SimpleNamespace(
        chat=SimpleNamespace(completions=normal_completions)
    )
    normal_stats = module.build_stats("")
    normal_output = io.StringIO()
    with contextlib.redirect_stdout(normal_output):
        normal_review = module.review_chunked_packets(
            normal_client,
            "review skill",
            chunk_inputs(),
            normal_stats,
            review_context,
        )
    assert normal_review["change_summary"] == ["Reviewed final judge."]
    assert len(normal_completions.calls) == 9, "eight chunks should need one call each plus one judge"
    assert normal_stats["model_calls"] == 9
    judge_prompt = "\n".join(
        message["content"] for message in normal_completions.calls[-1]["messages"]
    )
    assert "# Chunk Review Results" in judge_prompt
    assert "BUNNY_CHUNK_PACKET_" not in judge_prompt
    assert "PRIVATE_PACKET_TEXT_" not in judge_prompt
    telemetry = normal_output.getvalue()
    assert "chunk=1/8" in telemetry
    assert "chunk=8/8" in telemetry
    assert "state=complete" in telemetry
    assert "PRIVATE_PACKET_TEXT_" not in telemetry

    retry_completions = ChunkReviewCompletions(fail_once=3)
    retry_client = SimpleNamespace(chat=SimpleNamespace(completions=retry_completions))
    retry_stats = module.build_stats("")
    with contextlib.redirect_stdout(io.StringIO()):
        retry_review = module.review_chunked_packets(
            retry_client,
            "review skill",
            chunk_inputs(),
            retry_stats,
            review_context,
        )
    assert retry_review["change_summary"] == ["Reviewed final judge."]
    assert retry_completions.chunk_attempts[3] == 2
    assert all(
        attempts == (2 if index == 3 else 1)
        for index, attempts in retry_completions.chunk_attempts.items()
    ), "only the failed chunk should be retried"
    assert len(retry_completions.calls) == 10
    assert retry_stats["model_calls"] == 9, "timed-out calls are not successful model calls"

    schema_completions = ChunkReviewCompletions(invalid_then_valid=4)
    schema_client = SimpleNamespace(chat=SimpleNamespace(completions=schema_completions))
    schema_stats = module.build_stats("")
    with contextlib.redirect_stdout(io.StringIO()):
        schema_review = module.review_chunked_packets(
            schema_client,
            "review skill",
            chunk_inputs(),
            schema_stats,
            review_context,
        )
    assert schema_review["change_summary"] == ["Reviewed final judge."]
    assert schema_completions.chunk_attempts[4] == 3, (
        "a chunk that remains schema-invalid after repair should retry only that chunk"
    )
    assert all(
        attempts == (3 if index == 4 else 1)
        for index, attempts in schema_completions.chunk_attempts.items()
    )

    exhausted_completions = ChunkReviewCompletions(fail_always=2)
    exhausted_client = SimpleNamespace(
        chat=SimpleNamespace(completions=exhausted_completions)
    )
    exhausted_stats = module.build_stats("")
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            module.review_chunked_packets(
                exhausted_client,
                "review skill",
                chunk_inputs(),
                exhausted_stats,
                review_context,
            )
        except TimeoutError:
            pass
        else:
            raise AssertionError("an exhausted chunk must fail the full review")
    assert exhausted_completions.chunk_attempts == {1: 1, 2: 2}
    assert not any(
        "# Chunk Review Results"
        in "\n".join(message["content"] for message in call["messages"])
        for call in exhausted_completions.calls
    ), "final judging must not run after incomplete chunk coverage"

    three_pass_completions = ChunkReviewCompletions()
    three_pass_client = SimpleNamespace(
        chat=SimpleNamespace(completions=three_pass_completions)
    )
    three_pass_stats = module.build_stats("BUNNY_CHUNK_PACKET_1")
    module.three_pass_review(
        three_pass_client,
        "review skill",
        "BUNNY_CHUNK_PACKET_1",
        three_pass_stats,
    )
    assert three_pass_stats["model_calls"] == 3, "single-packet review must remain three-pass"
    return len(normal_completions.calls)


def run_model_key_case(module):
    old_llm = os.environ.get("LLM_API_KEY")
    old_openai = os.environ.get("OPENAI_API_KEY")
    try:
        os.environ["LLM_API_KEY"] = "provider-key"
        os.environ.pop("OPENAI_API_KEY", None)
        assert module.model_api_key() == "provider-key"
        os.environ.pop("LLM_API_KEY", None)
        os.environ["OPENAI_API_KEY"] = "openai-key"
        assert module.model_api_key() == "openai-key"
    finally:
        if old_llm is None:
            os.environ.pop("LLM_API_KEY", None)
        else:
            os.environ["LLM_API_KEY"] = old_llm
        if old_openai is None:
            os.environ.pop("OPENAI_API_KEY", None)
        else:
            os.environ["OPENAI_API_KEY"] = old_openai


def run_status_case(module):
    with tempfile.TemporaryDirectory(prefix="bunny-status-proof-") as tmp:
        root = pathlib.Path(tmp)
        review = root / "review.json"
        control = root / "bunny-ci-control.json"
        review.write_text(
            json.dumps({"findings": [], "pre_merge_checks": []}),
            encoding="utf-8",
        )
        control.write_text(
            json.dumps({"failed": [{"name": "De-Koi CI", "conclusion": "failure"}]}),
            encoding="utf-8",
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            module.status_state(
                SimpleNamespace(
                    review_json=str(review),
                    ci_control=str(control),
                    draft="false",
                    job_status="success",
                )
            )
        text = output.getvalue()
        assert "state=success" in text
        assert "Expected CI controls failed" not in text


def main():
    module = load_bunny_review()
    packet_len = run_packet_case(module)
    repair_calls = run_semantic_repair_case(module)
    chunk_calls = run_chunk_orchestration_case(module)
    run_model_key_case(module)
    run_status_case(module)
    print(
        "bunny_review_smoke "
        f"packet_len={packet_len} "
        f"semantic_repair_calls={repair_calls} "
        f"chunk_review_calls={chunk_calls} "
        "chunk_retry_scope=true "
        "chunk_schema_retry=true "
        "chunk_final_judge=true "
        "patch_overview_dedup=true "
        "packet_budget_chunking=true "
        "summary_fallback=true "
        "semantic_repair=true "
        "render_voice=true "
        "model_key_fallback=true "
        "ci_control_status_ignored=true"
    )


if __name__ == "__main__":
    main()
