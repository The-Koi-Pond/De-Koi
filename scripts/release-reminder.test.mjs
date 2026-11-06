import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  decideRelease,
  isUserFacing,
  newSecurityFixes,
  readState,
  renderIssue,
  summarizeChanges,
} from "./release-reminder.mjs";

const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const RULES = { maxAgeDays: 7, maxChanges: 20 };
const RELEASE = { tag: "v1.7.0", url: "https://example.test/v1.7.0" };

function commit(subject, files, { age = 1, editedFiles = files } = {}) {
  return { sha: `${subject.length}`.padEnd(40, "0"), subject, date: daysAgo(age), files, editedFiles };
}

describe("isUserFacing", () => {
  test("app code counts, docs, tests, CI and tooling don't", () => {
    assert.equal(isUserFacing(["src/features/shell/Home.tsx"]), true);
    assert.equal(isUserFacing(["src-tauri/src/http_server.rs"]), true);
    assert.equal(isUserFacing(["pnpm-lock.yaml"]), true);
    assert.equal(
      isUserFacing([
        "docs/install.md",
        "README.md",
        ".github/workflows/ci-full.yml",
        "scripts/check-docs.mjs",
        "src/engine/memory/recall.spec.ts",
        "tests/unit/prompt-snapshots/roleplay.txt",
        "src-tauri/src/commands/storage/deki/tests.rs",
        "docker-compose.pi.yml",
      ]),
      false,
    );
  });
});

describe("summarizeChanges", () => {
  test("reads the PR number and the modes whose prompt snapshot was edited", () => {
    const [change] = summarizeChanges([
      commit("Rank recalled memories by the question (#1565)", [
        "src/engine/memory/recall.ts",
        "tests/unit/prompt-snapshots/roleplay.txt",
      ]),
    ]);
    assert.equal(change.pr, 1565);
    assert.equal(change.title, "Rank recalled memories by the question");
    assert.deepEqual(change.promptModes, ["Roleplay"]);
  });

  test("adding a snapshot is not a prompt change", () => {
    const files = ["src/engine/generation/a.ts", "tests/unit/prompt-snapshots/fanfic.txt"];
    const [change] = summarizeChanges([commit("Add snapshots (#1552)", files, { editedFiles: [files[0]] })]);
    assert.deepEqual(change.promptModes, []);
  });

  test("flags security fixes from the subject", () => {
    const [change] = summarizeChanges([commit("Bump tokio for RUSTSEC-2026-0386 (#1570)", ["src-tauri/Cargo.lock"])]);
    assert.equal(change.security, true);
  });
});

describe("decideRelease", () => {
  test("nothing waiting is never due", () => {
    const changes = summarizeChanges([commit("Docs only (#1)", ["docs/a.md"], { age: 30 })]);
    assert.equal(decideRelease({ changes, now: NOW, rules: RULES }).due, false);
  });

  test("a few recent changes are not due yet", () => {
    const changes = summarizeChanges([commit("Fix a button (#2)", ["src/a.tsx"], { age: 3 })]);
    assert.equal(decideRelease({ changes, now: NOW, rules: RULES }).due, false);
  });

  test("due once the oldest change is old enough", () => {
    const changes = summarizeChanges([commit("Fix a button (#2)", ["src/a.tsx"], { age: 8 })]);
    const decision = decideRelease({ changes, now: NOW, rules: RULES });
    assert.equal(decision.due, true);
    assert.match(decision.reasons[0], /8 days ago/);
  });

  test("due once enough changes pile up", () => {
    const changes = summarizeChanges(
      Array.from({ length: 20 }, (_, index) => commit(`Change ${index} (#${index + 10})`, ["src/a.tsx"])),
    );
    assert.equal(decideRelease({ changes, now: NOW, rules: RULES }).due, true);
  });

  test("a security fix is due right away", () => {
    const changes = summarizeChanges([commit("Bump rustls for RUSTSEC-2026-0381 (#1499)", ["src-tauri/Cargo.lock"])]);
    const decision = decideRelease({ changes, now: NOW, rules: RULES });
    assert.equal(decision.due, true);
    assert.match(decision.reasons[0], /#1499/);
  });
});

describe("the reminder issue", () => {
  const changes = summarizeChanges([
    commit("Bump rustls for RUSTSEC-2026-0381 (#1499)", ["src-tauri/Cargo.lock"], { age: 9 }),
    commit("Docs only (#1500)", ["docs/a.md"], { age: 8 }),
    commit("Fix a prompt (#1501)", ["src/engine/a.ts", "tests/unit/prompt-snapshots/conversation.txt"]),
  ]);
  const decision = decideRelease({ changes, now: NOW, rules: RULES });
  const issue = renderIssue({ repository: "The-Koi-Pond/De-Koi", release: RELEASE, changes, decision });

  test("lists waiting changes newest first, quality runs, and keeps docs-only changes apart", () => {
    assert.equal(issue.title, "Release due: 2 changes since v1.7.0");
    const notes = issue.body.slice(issue.body.indexOf("## Draft notes"), issue.body.indexOf("<details>"));
    assert.ok(notes.indexOf("(#1501)") < notes.indexOf("(#1499)"));
    assert.ok(!notes.includes("#1500"));
    assert.match(issue.body, /\*\*Conversation:\*\* #1501/);
    assert.match(issue.body, /Not in the app \(1\)/);
  });

  test("remembers the release and security fixes it was written for", () => {
    assert.deepEqual(readState(issue.body), { since: "v1.7.0", security: ["#1499"] });
    assert.deepEqual(newSecurityFixes(issue.body, issue.body), []);
    const older = issue.body.replace('"security":["#1499"]', '"security":[]');
    assert.deepEqual(newSecurityFixes(older, issue.body), ["#1499"]);
  });
});
