// Decides whether De-Koi is due for a release and keeps one reminder issue in step.
//
//   node scripts/release-reminder.mjs            needs GITHUB_TOKEN and GITHUB_REPOSITORY
//   node scripts/release-reminder.mjs --dry-run  prints the decision and the issue, writes nothing
//
// It compares the latest published release with main. When enough user-facing
// changes are waiting (see DEFAULT_RULES), it opens an issue labelled
// `release-due`, assigned to RELEASE_MANAGERS, with draft release notes and the
// modes that need a quality run before publishing. Later runs update that issue
// quietly, comment when a security fix lands, and close it once nothing is due
// (normally right after the next release is published).

import path from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "release-due";
const MARKER = "release-reminder";

export const DEFAULT_RULES = {
  // The oldest unreleased user-facing change is this many days old.
  maxAgeDays: 7,
  // This many user-facing changes are waiting.
  maxChanges: 20,
};

// Files that never reach a release build. A change that only touches these
// (docs, tests, CI, repo tooling, server deploy files) doesn't need a release.
const NON_SHIPPING = [
  /^(?:docs|\.github|\.agents|\.vscode|skills|scripts|tests|pr-evidence|test-results|branding|deploy|docker)\//,
  /^docker-compose[^/]*\.ya?ml$/,
  /^(?:knip\.json|lighthouserc\.cjs|playwright\.config\.ts|vitest\.config\.ts|eslint[^/]*\.js)$/,
  /\.md$/i,
  /\.(?:spec|test)\.[cm]?[jt]sx?$/,
  /(?:^|\/)tests?\//,
  /(?:^|\/)(?:tests|[^/]+_tests?)\.rs$/,
];

// One prompt snapshot per mode. A change to one means that mode's prompt changed,
// and the release checklist asks for a quality run for it.
const PROMPT_SNAPSHOTS = {
  "tests/unit/prompt-snapshots/conversation.txt": "Conversation",
  "tests/unit/prompt-snapshots/roleplay.txt": "Roleplay",
  "tests/unit/prompt-snapshots/fanfic.txt": "Fanfic",
  "tests/unit/prompt-snapshots/deki.txt": "Deki-senpai",
};

const SECURITY_PATTERN = /\b(?:RUSTSEC-\d{4}-\d+|CVE-\d{4}-\d+|GHSA(?:-[\w]{4}){3}|security)\b/i;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isUserFacing(files) {
  return files.some((file) => !NON_SHIPPING.some((pattern) => pattern.test(file)));
}

export function promptModes(files) {
  return [...new Set(files.map((file) => PROMPT_SNAPSHOTS[file]).filter(Boolean))];
}

// commits: [{ sha, subject, date, files, editedFiles }] from the compare, oldest first.
// editedFiles leaves out new files: adding a snapshot is not a prompt change.
export function summarizeChanges(commits) {
  return commits.map((commit) => {
    const pr = commit.subject.match(/\(#(\d+)\)\s*$/);
    return {
      sha: commit.sha,
      pr: pr ? Number(pr[1]) : null,
      title: commit.subject.replace(/\s*\(#\d+\)\s*$/, ""),
      date: commit.date,
      userFacing: isUserFacing(commit.files),
      security: SECURITY_PATTERN.test(commit.subject),
      promptModes: promptModes(commit.editedFiles),
    };
  });
}

export function decideRelease({ changes, now, rules = DEFAULT_RULES }) {
  // A security word in a docs or tooling commit is not a reason to ship.
  const waiting = changes.filter((change) => change.userFacing);
  const reasons = [];
  if (waiting.length === 0) return { due: false, reasons, waiting, ageDays: 0 };

  const oldest = Math.min(...waiting.map((change) => Date.parse(change.date)));
  const ageDays = Math.floor((now.getTime() - oldest) / DAY_MS);
  const security = waiting.filter((change) => change.security);

  if (security.length > 0) {
    reasons.push(`Security fix waiting: ${security.map(ref).join(", ")}.`);
  }
  if (ageDays >= rules.maxAgeDays) {
    reasons.push(`The oldest unreleased change merged ${ageDays} days ago (limit: ${rules.maxAgeDays}).`);
  }
  if (waiting.length >= rules.maxChanges) {
    reasons.push(`${waiting.length} user-facing changes are waiting (limit: ${rules.maxChanges}).`);
  }
  return { due: reasons.length > 0, reasons, waiting, ageDays };
}

function count(number, word) {
  return `${number} ${word}${number === 1 ? "" : "s"}`;
}

function ref(change) {
  return change.pr ? `#${change.pr}` : change.sha.slice(0, 10);
}

function line(change) {
  return `- ${change.title} (${ref(change)})`;
}

export function renderIssue({ repository, release, changes, decision }) {
  const { waiting, reasons, ageDays } = decision;
  const other = changes.filter((change) => !waiting.includes(change));
  const security = waiting.filter((change) => change.security).map(ref);

  const quality = new Map();
  for (const change of changes) {
    for (const mode of change.promptModes) {
      quality.set(mode, [...(quality.get(mode) ?? []), ref(change)]);
    }
  }

  const docs = `https://github.com/${repository}/blob/main/docs`;
  const state = JSON.stringify({ since: release.tag, security });
  const body = [
    `<!-- ${MARKER} ${state} -->`,
    `**A De-Koi release is due.** ${count(waiting.length, "user-facing change")} merged since [${release.tag}](${release.url}); the oldest is ${count(ageDays, "day")} old.`,
    "",
    "Why now:",
    ...reasons.map((reason) => `- ${reason}`),
    "",
    "## Before you publish",
    "",
    quality.size > 0
      ? `These modes' prompts changed, so the [release checklist](${docs}/release-readiness-checklist.md) asks for one quality run each (release candidate vs ${release.tag}):`
      : `No change touched a prompt snapshot, so no quality run is needed.`,
    ...[...quality].map(([mode, refs]) => `- **${mode}:** ${refs.join(", ")}`),
    "",
    "## How to release",
    "",
    `1. Bump the version in \`package.json\`, \`src-tauri/Cargo.toml\` (and \`Cargo.lock\`) and \`src-tauri/tauri.conf.json\`, then merge it.`,
    `2. Run [Release](https://github.com/${repository}/actions/workflows/release.yml) on \`main\` and paste the notes below.`,
    `3. Check the draft against the [release checklist](${docs}/release-readiness-checklist.md), then publish it.`,
    "",
    `Full steps: [Cutting a release](${docs}/release-update-strategy.md#cutting-a-release). This issue closes itself once nothing is waiting.`,
    "",
    "## Draft notes",
    "",
    ...[...waiting].reverse().map(line),
    "",
    ...(other.length > 0
      ? [
          `<details><summary>Not in the app (${other.length}): docs, tests, CI and tooling</summary>`,
          "",
          ...[...other].reverse().map(line),
          "",
          "</details>",
        ]
      : []),
  ].join("\n");

  return { title: `Release due: ${count(waiting.length, "change")} since ${release.tag}`, body };
}

export function readState(body) {
  const match = body?.match(new RegExp(`<!-- ${MARKER} (\\{.*?\\}) -->`));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Security fixes that weren't in the issue last time, so a quiet body edit isn't enough.
export function newSecurityFixes(previousBody, nextBody) {
  const before = new Set(readState(previousBody)?.security ?? []);
  return (readState(nextBody)?.security ?? []).filter((item) => !before.has(item));
}

function numberFromEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`expected a whole number of at least 1, got "${value}"`);
  }
  return number;
}

function github({ token, apiUrl, repository }) {
  return async function request(method, route, body) {
    const response = await fetch(`${apiUrl}/repos/${repository}${route}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) {
      throw new Error(`${method} ${route} failed: ${response.status} ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

async function loadCommits(request, tag, branch) {
  const commits = [];
  for (let page = 1; ; page += 1) {
    const compare = await request("GET", `/compare/${tag}...${branch}?per_page=100&page=${page}`);
    if (!compare) throw new Error(`could not compare ${tag} with ${branch}`);
    commits.push(...compare.commits);
    if (compare.commits.length < 100 || commits.length >= compare.total_commits) break;
  }

  const detailed = [];
  for (const commit of commits) {
    // The merge queue squashes, so main has no merge commits; skip any that show up.
    if (commit.parents.length > 1) continue;
    const full = await request("GET", `/commits/${commit.sha}`);
    const files = full.files ?? [];
    detailed.push({
      sha: commit.sha,
      subject: commit.commit.message.split("\n")[0],
      date: commit.commit.committer.date,
      files: files.map((file) => file.filename),
      editedFiles: files.filter((file) => file.status !== "added").map((file) => file.filename),
    });
  }
  return detailed;
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");

  const request = github({ token, apiUrl: process.env.GITHUB_API_URL || "https://api.github.com", repository });
  const rules = {
    maxAgeDays: numberFromEnv(process.env.RELEASE_REMINDER_DAYS, DEFAULT_RULES.maxAgeDays),
    maxChanges: numberFromEnv(process.env.RELEASE_REMINDER_CHANGES, DEFAULT_RULES.maxChanges),
  };
  const managers = (process.env.RELEASE_MANAGERS ?? "")
    .split(",")
    .map((login) => login.trim())
    .filter(Boolean);

  const latest = await request("GET", "/releases/latest");
  if (!latest) throw new Error("no published release found; publish the first release by hand");
  const release = { tag: latest.tag_name, url: latest.html_url };

  const changes = summarizeChanges(await loadCommits(request, release.tag, "main"));
  const decision = decideRelease({ changes, now: new Date(), rules });
  console.log(
    `${changes.length} commits since ${release.tag}, ${decision.waiting.length} user-facing; ` +
      (decision.due ? `release due: ${decision.reasons.join(" ")}` : "no release due"),
  );

  const issue = decision.due ? renderIssue({ repository, release, changes, decision }) : null;
  const open = (await request("GET", `/issues?state=open&labels=${LABEL}&per_page=10`)) ?? [];
  let current = open.find((item) => !item.pull_request && readState(item.body));
  // An issue from before the latest release is finished; a new one (if due) gets a fresh notification.
  const stale = current && readState(current.body).since !== release.tag ? current : null;
  if (stale) current = null;

  if (dryRun) {
    if (stale) console.log(`would close #${stale.number} (${release.tag} is out)`);
    console.log(current ? `would update #${current.number}` : issue ? "would open a new issue" : "nothing to write");
    if (issue) console.log(`\n${issue.title}\n\n${issue.body}`);
    return;
  }

  if (stale) {
    await request("POST", `/issues/${stale.number}/comments`, {
      body: `${release.tag} is out, so nothing from this list is waiting any more. Closing.`,
    });
    await request("PATCH", `/issues/${stale.number}`, { state: "closed", state_reason: "completed" });
    console.log(`closed #${stale.number}`);
  }

  if (issue && !current) {
    if (!(await request("GET", `/labels/${LABEL}`))) {
      await request("POST", "/labels", {
        name: LABEL,
        color: "0e8a16",
        description: "Unreleased changes are waiting for a release",
      });
    }
    const created = await request("POST", "/issues", { ...issue, labels: [LABEL], assignees: managers });
    console.log(
      `opened #${created.number}${managers.length ? ` for ${managers.join(", ")}` : " (no RELEASE_MANAGERS set)"}`,
    );
  } else if (issue && current) {
    const fresh = newSecurityFixes(current.body, issue.body);
    if (current.title !== issue.title || current.body !== issue.body) {
      await request("PATCH", `/issues/${current.number}`, issue);
      console.log(`updated #${current.number}`);
    }
    if (fresh.length > 0) {
      await request("POST", `/issues/${current.number}/comments`, {
        body: `A security fix landed: ${fresh.join(", ")}. Worth releasing soon.`,
      });
      console.log(`commented on #${current.number} about ${fresh.join(", ")}`);
    }
  } else if (!issue && current) {
    await request("POST", `/issues/${current.number}/comments`, {
      body: "Nothing user-facing is waiting under the current rules. Closing.",
    });
    await request("PATCH", `/issues/${current.number}`, { state: "closed", state_reason: "completed" });
    console.log(`closed #${current.number}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-reminder: ${error.message}`);
    process.exit(1);
  }
}
