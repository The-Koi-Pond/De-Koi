import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-discovery-metadata.mjs");
const registry = "src/features/shell/discovery/discovery-entries.json";
const naBody = [
  "## Feature Discoverability",
  "",
  "- [x] N/A because this PR is only a bugfix.",
  "",
  "Reason:",
  "",
  "- Bug fix on an existing window.",
].join("\n");

// A throwaway repo where origin/main is the base and HEAD changes one UI file,
// the same shape as a pull request or a merge queue commit on top of main.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "discovery-check-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.autocrlf", "false");
  mkdirSync(join(dir, dirname(registry)), { recursive: true });
  copyFileSync(join(repoRoot, registry), join(dir, registry));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  mkdirSync(join(dir, "src/features/example"), { recursive: true });
  writeFileSync(join(dir, "src/features/example/Example.tsx"), "export const Example = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "ui change");
  return dir;
}

function runCheck(dir, eventName, event) {
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  return spawnSync(process.execPath, [script, "--pr-aware"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_BASE_REF: eventName === "pull_request" ? "main" : "",
      DISCOVERY_CHECK_WARN_ONLY: "",
      DISCOVERY_CHECK_ALLOW_MISSING: "",
    },
  });
}

test("a pull request that changes UI needs a discovery decision", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const missing = runCheck(dir, "pull_request", { pull_request: { body: "" } });
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /src\/features\/example\/Example\.tsx/);

  const marked = runCheck(dir, "pull_request", { pull_request: { body: naBody } });
  assert.equal(marked.status, 0, marked.stdout + marked.stderr);
  assert.match(marked.stdout, /accepted explicit Feature Discoverability N\/A marker/);
});

test("a merge queue run does not re-check the PR body it does not have", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCheck(dir, "merge_group", {
    action: "checks_requested",
    merge_group: { base_ref: "refs/heads/main", head_ref: "refs/heads/gh-readonly-queue/main/pr-1-abc" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Merge queue run: Feature Discoverability was checked on each pull request\./);
  assert.doesNotMatch(result.stdout, /changed file\(s\)/);
});
