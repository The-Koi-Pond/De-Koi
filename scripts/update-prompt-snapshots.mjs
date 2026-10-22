// Rewrites the prompt snapshot files in tests/unit/prompt-snapshots after an intended prompt change.
// Review the resulting diff before committing it: it is exactly what changed in the prompt.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Conversation, Roleplay and Fanfic prompts are built by the TypeScript engine.
run(process.execPath, [
  join(repoRoot, "node_modules", "vitest", "vitest.mjs"),
  "run",
  "tests/unit/prompt-snapshots",
  "--update",
]);
// Deki-senpai's prompt is built in Rust.
run(
  "cargo",
  ["test", "--manifest-path", "src-tauri/Cargo.toml", "-p", "de-koi", "--lib", "deki_first_request_matches_snapshot"],
  { UPDATE_PROMPT_SNAPSHOTS: "1" },
);
