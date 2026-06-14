import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile


sys.dont_write_bytecode = True

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / ".github" / "bunny-review" / "bunny_review.py"


def load_bunny_review():
    spec = importlib.util.spec_from_file_location("bunny_review_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_repo(root, paths):
    tool_dir = root / ".github" / "bunny-review"
    tool_dir.mkdir(parents=True)
    (tool_dir / "reviewer-prompt.md").write_text("prompt", encoding="utf-8")
    (tool_dir / "rules.json").write_text(
        json.dumps(
            {
                "path_instructions": [
                    {
                        "prefixes": ["src/"],
                        "guidance": paths,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (root / "AGENTS.md").write_text(
        "# Repo Instructions\n\n## Hard Rules\n\n" + ("REQUIRED_AGENTS_RULE\n" * 2000),
        encoding="utf-8",
    )

    workflow = root / "skills" / "de-koi-agent-workflow" / "SKILL.md"
    workflow.parent.mkdir(parents=True, exist_ok=True)
    workflow.write_text("# Agent workflow\n\nRequired workflow guidance.\n", encoding="utf-8")

    for path in paths:
        full = root / path
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(
            "# Skill\n\n" + (f"{path} visible rule\n" * 400),
            encoding="utf-8",
        )
    return tool_dir


def assert_agents_accounted(digest):
    assert "AGENTS.md" in digest, "AGENTS.md is not visible or explicitly omitted"
    assert (
        "## AGENTS.md hard rules" in digest
        or "AGENTS.md was omitted" in digest
        or "## guidance: AGENTS.md" in digest
    ), "AGENTS.md lacks content or an omission note"


def assert_selected_accounted(digest, selected_paths):
    for path in selected_paths:
        assert path in digest, f"{path} is not visible or explicitly omitted"


def run_case(module, root, tool_dir, paths, *, compact):
    module.REPO_ROOT = root
    os.environ["BUNNY_REVIEW_PROMPT_PATH"] = str(tool_dir / "reviewer-prompt.md")
    digest = module.build_repo_guidance_digest(["src/example.ts"], compact=compact)
    limit = (
        module.MAX_COMPACT_GUIDANCE_DIGEST_CHARS
        if compact
        else module.MAX_GUIDANCE_DIGEST_CHARS
    )
    assert len(digest) <= limit, f"guidance digest length {len(digest)} exceeds {limit}"
    assert_agents_accounted(digest)
    selected = [
        path
        for path in module.guidance_paths_for_files(["src/example.ts"])
        if path != "AGENTS.md"
    ]
    assert_selected_accounted(digest, selected)
    return digest, limit


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


def write_contract_trace_repo(root):
    (root / "AGENTS.md").write_text("# Repo Instructions\n", encoding="utf-8")
    tool_dir = root / ".github" / "bunny-review"
    tool_dir.mkdir(parents=True)
    (tool_dir / "reviewer-prompt.md").write_text("prompt", encoding="utf-8")
    (tool_dir / "rules.json").write_text(json.dumps({"path_instructions": []}), encoding="utf-8")

    impl = root / "src" / "engine" / "generation" / "agent-runner.ts"
    test = root / "src" / "engine" / "generation" / "agent-runner.test.ts"
    impl.parent.mkdir(parents=True, exist_ok=True)
    impl.write_text(
        "export function resolveSidecar(value: string): string {\n"
        "  return value;\n"
        "}\n",
        encoding="utf-8",
    )
    test.write_text(
        "import { resolveSidecar } from './agent-runner';\n"
        "export const proof = resolveSidecar('old');\n",
        encoding="utf-8",
    )
    run_git(root, "init", "-q")
    run_git(root, "config", "user.email", "bunny@example.invalid")
    run_git(root, "config", "user.name", "Bunny Proof")
    run_git(root, "add", ".")
    run_git(root, "commit", "-q", "-m", "base")
    impl.write_text(
        "export function resolveSidecar(value: string): string {\n"
        "  return value === 'sidecar' ? 'skipped' : value;\n"
        "}\n",
        encoding="utf-8",
    )
    test.write_text(
        "import { resolveSidecar } from './agent-runner';\n"
        "export const proof = resolveSidecar('sidecar');\n",
        encoding="utf-8",
    )
    run_git(root, "add", ".")
    run_git(root, "commit", "-q", "-m", "head")
    return tool_dir


def run_contract_trace_case(module):
    with tempfile.TemporaryDirectory(prefix="bunny-contract-proof-") as tmp:
        root = pathlib.Path(tmp)
        tool_dir = write_contract_trace_repo(root)
        module.REPO_ROOT = root
        os.environ["BUNNY_REVIEW_PROMPT_PATH"] = str(tool_dir / "reviewer-prompt.md")
        entry = {
            "id": "contract-1",
            "status": "prior",
            "severity": "medium",
            "path": "src/engine/generation/agent-runner.ts",
            "line": 2,
            "title": "Fallback sidecar still reaches execution",
            "fix_hint": "Move the sidecar guard in `src/engine/generation/agent-runner.ts`.",
            "repair_contract": {
                "related_failure_paths": ["`src/engine/generation/agent-runner.ts`"],
                "expected_proof": ["Focused proof in `src/engine/generation/agent-runner.test.ts`."],
            },
        }
        files = [
            "src/engine/generation/agent-runner.ts",
            "src/engine/generation/agent-runner.test.ts",
        ]
        normalized = module.normalize_contract_state_entries([entry])
        assert normalized[0]["owner_paths"] == ["src/engine/generation/agent-runner.ts"]
        assert "src/engine/generation/agent-runner.test.ts" in normalized[0]["proof_paths"]

        groups = module.contract_changed_path_groups(files, normalized)
        chunks = module.merge_contract_related_chunks([[files[0]], [files[1]]], groups)
        assert chunks == [files], f"contract-related files were not co-located: {chunks}"
        left, right = module.split_chunk(["a.ts", files[0], files[1], "z.ts"], groups)
        assert {files[0], files[1]}.issubset(left) or {files[0], files[1]}.issubset(right), (
            "packet splitter separated contract-related files"
        )

        trace = module.build_prior_contract_trace_context(
            "HEAD~1",
            normalized,
            files,
            focus_files=[files[0]],
        )
        assert "Prior contract trace context" in trace
        assert "src/engine/generation/agent-runner.test.ts" in trace
        assert "Changed hunk sketch" in trace
        assert "sidecar" in trace
        return len(trace), len(chunks[0])


def write_large_packet_repo(root):
    (root / "AGENTS.md").write_text("# Repo Instructions\n", encoding="utf-8")
    tool_dir = root / ".github" / "bunny-review"
    tool_dir.mkdir(parents=True)
    (tool_dir / "reviewer-prompt.md").write_text("prompt", encoding="utf-8")
    (tool_dir / "rules.json").write_text(json.dumps({"path_instructions": []}), encoding="utf-8")

    src = root / "src"
    src.mkdir()
    large = src / "large-packet.ts"
    small = src / "small-packet.ts"
    large.write_text("export const oldValue = 0;\n", encoding="utf-8")
    small.write_text("export const smallValue = 0;\n", encoding="utf-8")
    run_git(root, "init", "-q")
    run_git(root, "config", "user.email", "bunny@example.invalid")
    run_git(root, "config", "user.name", "Bunny Proof")
    run_git(root, "add", ".")
    run_git(root, "commit", "-q", "-m", "base")

    large_lines = [
        f"export const generatedLargePacketValue{index} = {index};"
        for index in range(1400)
    ]
    large_lines.append('export const packetTailMarker = "visible";')
    large.write_text("\n".join(large_lines) + "\n", encoding="utf-8")
    small.write_text("export const smallValue = 1;\n", encoding="utf-8")
    run_git(root, "add", ".")
    run_git(root, "commit", "-q", "-m", "head")
    return tool_dir


def run_large_packet_budget_case(module):
    with tempfile.TemporaryDirectory(prefix="bunny-large-packet-proof-") as tmp:
        root = pathlib.Path(tmp)
        tool_dir = write_large_packet_repo(root)
        module.REPO_ROOT = root
        os.environ["BUNNY_REVIEW_PROMPT_PATH"] = str(tool_dir / "reviewer-prompt.md")
        base = "HEAD~1"
        large_path = "src/large-packet.ts"
        tail_line = '+export const packetTailMarker = "visible";'
        files = module.changed_files(base)
        large_diff_len = len(module.diff_for_path(base, large_path))
        assert large_diff_len > module.MAX_FILE_PATCH_CHARS

        packet = module.build_review_packet(base, "", "full", emit_telemetry=False)
        assert tail_line in packet, "large diff tail was summarized despite packet budget"
        assert len(packet) <= module.MAX_REVIEW_PACKET_CHARS

        plan = module.plan_review_chunks(base, "", "full", files)
        assert plan["forced_by_packet_size"], "large affordable packet did not trigger chunk planning"
        assert any(chunk == [large_path] for chunk in plan["chunks"]), (
            f"large file was not isolated for focused review: {plan['chunks']}"
        )

        focused = module.build_review_packet(
            base,
            "",
            "full",
            focus_files=[large_path],
            include_full_patch=False,
            global_context=plan["global_review_context"],
            emit_telemetry=False,
        )
        assert tail_line in focused, "focused packet omitted large diff tail"
        return large_diff_len, len(packet), len(plan["chunks"])


def main():
    module = load_bunny_review()
    with tempfile.TemporaryDirectory(prefix="bunny-guidance-proof-") as tmp:
        root = pathlib.Path(tmp)
        many_paths = [f"skills/test-guidance-{index}/SKILL.md" for index in range(80)]
        tool_dir = write_repo(root, many_paths)

        standard, standard_limit = run_case(module, root, tool_dir, many_paths, compact=False)
        compact_many, compact_limit = run_case(module, root, tool_dir, many_paths, compact=True)
        assert "AGENTS.md was omitted" in compact_many or "REQUIRED_AGENTS_RULE" in compact_many

        (tool_dir / "rules.json").write_text(
            json.dumps(
                {
                    "path_instructions": [
                        {
                            "prefixes": ["src/"],
                            "guidance": many_paths[:3],
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        compact_selected, selected_limit = run_case(
            module,
            root,
            tool_dir,
            many_paths[:3],
            compact=True,
        )
        contract_trace_len, contract_chunk_size = run_contract_trace_case(module)
        large_diff_len, large_packet_len, large_packet_chunks = run_large_packet_budget_case(module)

        print(
            "standard_many_guidance "
            f"len={len(standard)} limit={standard_limit} agents_accounted=true"
        )
        print(
            "compact_many_guidance "
            f"len={len(compact_many)} limit={compact_limit} agents_accounted=true"
        )
        print(
            "compact_selected_guidance "
            f"len={len(compact_selected)} limit={selected_limit} "
            "agents_and_selected_paths_accounted=true"
        )
        print(
            "contract_trace_context "
            f"len={contract_trace_len} co_located_files={contract_chunk_size} "
            "prior_contract_paths_accounted=true"
        )
        print(
            "large_packet_context "
            f"diff_len={large_diff_len} packet_len={large_packet_len} "
            f"chunks={large_packet_chunks} tail_visible=true"
        )


if __name__ == "__main__":
    main()
