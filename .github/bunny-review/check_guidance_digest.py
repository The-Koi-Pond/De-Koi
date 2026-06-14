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
    run_model_key_case(module)
    run_status_case(module)
    print(
        "bunny_review_smoke "
        f"packet_len={packet_len} "
        "patch_overview_dedup=true "
        "packet_budget_chunking=true "
        "summary_fallback=true "
        "render_voice=true "
        "model_key_fallback=true "
        "ci_control_status_ignored=true"
    )


if __name__ == "__main__":
    main()
