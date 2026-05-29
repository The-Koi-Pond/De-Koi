# Graphify Instructions

Graphify is the persistent repository map for the Marinara Engine `refactor` branch. It turns the project files into a knowledge graph under `graphify-out/` so agents can query relationships instead of repeatedly sweeping raw files.

## Prerequisites

Keep Graphify installed and available before codebase-navigation, architecture, file-relationship, or implementation work on this branch.

| Requirement | Minimum | Check | Install |
| --- | --- | --- | --- |
| Python | 3.10+ | `python --version` | [python.org](https://www.python.org/downloads/) |
| `uv` (recommended) | Any | `uv --version` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `pipx` (alternative) | Any | `pipx --version` | `pip install pipx` |

Quick installs:

```sh
# macOS with Homebrew
brew install python@3.12 uv

# Windows
winget install astral-sh.uv

# Ubuntu/Debian
sudo apt install python3.12 python3-pip pipx

# Ubuntu/Debian uv alternative
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Install Graphify

The official PyPI package is `graphifyy` (double-y). Other `graphify*` packages on PyPI are not affiliated. The CLI command is still `graphify`.

Install the package:

```sh
# Recommended: uv puts graphify on PATH automatically.
uv tool install graphifyy

# Alternatives.
pipx install graphifyy
pip install graphifyy
```

Then apply Marinara's portability patch for Graphify `0.8.21` installs:

```sh
pnpm graphify:patch
```

Run the patch again after reinstalling or upgrading `graphifyy`. It prevents
generated cache files and node IDs from embedding local absolute workspace
paths.

For any further installation instructions, please follow the relevant segment of the installation guide via [this repo](https://github.com/safishamsi/graphify)

## Required Workflow

- This repository has a persistent `graphify-out/` map. Use it as navigational evidence, not as an authority over current source files.
- Before broad architecture, unfamiliar-area, dependency, or file-relationship exploration, read `graphify-out/GRAPH_REPORT.md` or use `graphify query "<question>"`.
- Prefer scoped graph queries over broad raw-file searches when the question is about relationships between areas.
- After installing, reinstalling, or upgrading Graphify, run `pnpm graphify:patch` before refreshing the map.
- After every code change, run `graphify update .` from the repository root so the map stays current.
- For docs, PDFs, images, or other semantic-source changes, run `/graphify . --update` or the equivalent Graphify update path so semantic nodes are refreshed.
- Do not hand-edit generated `graphify-out/` files.
- If Graphify is unavailable, say so in the final response and fall back to direct source inspection. Do not invent graph evidence.

## Common Commands

- `graphify .`: build or rebuild the graph for the current repository.
- `graphify update .`: incrementally update the existing graph after changes.
- `graphify query "<question>"`: ask a relationship question against `graphify-out/graph.json`.
- `graphify path "Node A" "Node B"`: find the shortest path between two concepts.
- `graphify explain "Node"`: explain one node and its neighbors.
- `graphify export callflow-html`: generate a Mermaid architecture/call-flow HTML view.
- `graphify hook install`: install post-commit/post-checkout hooks that rebuild graph output and configure merge handling for `graph.json`.
- `graphify hook status`: check whether the hooks are installed.

PowerShell note: use `graphify .`, not `/graphify .`, because a leading slash is treated as a path separator.

## What Graphify Builds

The core outputs live in `graphify-out/`:

- `graphify-out/graph.html`: interactive graph for browser exploration, search, filtering, and community navigation.
- `graphify-out/GRAPH_REPORT.md`: human-readable highlights, report sections, freshness information, and suggested questions.
- `graphify-out/graph.json`: persistent graph data that can be queried later without re-reading the whole repository.
- `graphify-out/wiki/`: optional agent-crawlable Markdown wiki when built with `--wiki`.
- `graphify-out/cache/`: content-hash cache so unchanged files are skipped on future runs.

## How It Works

- Detection finds supported code, docs, PDFs, images, video/audio, office files with optional extras, and selected config formats.
- Code extraction runs locally with tree-sitter and call-graph passes. Normal code-only updates do not require LLM semantic extraction.
- Video and audio transcription runs locally when the `video` extra is installed.
- Docs, PDFs, images, and transcripts use the configured assistant or headless backend for semantic extraction.
- Graph construction uses nodes, edges, confidence tags, community detection, and analysis to produce reports and queryable graph data.
- Every relationship is tagged `EXTRACTED`, `INFERRED`, or `AMBIGUOUS` so readers can tell source facts from model inferences.

## Reading `GRAPH_REPORT.md`

Use the report as a navigation map. Verify behavior claims against source files before changing code or giving final answers.

- `Corpus Check`: file count, approximate word count, and whether the corpus is large enough for graph structure to add value.
- `Summary`: node count, edge count, community count, extraction confidence mix, and token cost.
- `Graph Freshness`: commit the graph was built from, with a reminder to compare against `git rev-parse HEAD` and run `graphify update .` after code changes.
- `Community Hubs (Navigation)`: links into community hub pages when Obsidian/wiki-style outputs exist.
- `God Nodes`: the highest-degree concepts, functions, utilities, or abstractions. These often reveal central coupling points or utility hubs.
- `Surprising Connections`: cross-file or cross-module links ranked for unexpectedness. Treat inferred entries as leads to verify, not as proof.
- `Hyperedges`: group relationships connecting three or more nodes when the group relationship matters beyond pairwise edges.
- `Communities`: clusters of related nodes with cohesion scores. Low cohesion can indicate broad or weakly connected areas; high cohesion can indicate tightly related feature or infrastructure slices.
- `Ambiguous Edges`: relationships Graphify could not classify confidently. Review these manually before relying on them.
- `Knowledge Gaps`: isolated nodes, thin communities, or high ambiguity that may signal missing edges, missing docs, or stale graph output.
- `Suggested Questions`: relationship questions the graph is well positioned to answer. These are good starting points for `graphify query`.

## Confidence Tags

- `EXTRACTED`: directly found in the source, such as imports, direct calls, citations, or explicit references.
- `INFERRED`: reasonable deduction from naming, context, shared data, or semantic alignment. Check the confidence score and verify in source.
- `AMBIGUOUS`: uncertain relationship flagged for human review. Do not treat it as established behavior.

## Privacy And Scope

- Code files are processed locally for AST extraction.
- Docs, PDFs, images, and transcripts may be sent through the configured AI backend for semantic extraction.
- Do not graph private chat transcripts, secrets, generated dependency/build output, provider caches, or unrelated workspace folders unless the user explicitly asks and the scope is safe.
- Do not commit local absolute workspace paths in Graphify outputs; use repo-relative paths such as `src/...`, keep Marinara's Graphify portability patch applied, and verify path hygiene before sharing or committing `graphify-out/`.
- Use Graphify to decide where to inspect, then cite and trust source files, tests, and project docs for behavior.
