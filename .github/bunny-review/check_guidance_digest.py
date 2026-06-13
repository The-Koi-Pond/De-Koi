import importlib.util
import json
import os
import pathlib
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


if __name__ == "__main__":
    main()
