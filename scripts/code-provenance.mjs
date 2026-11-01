#!/usr/bin/env node
// Reports how much of De-Koi's code is owned by the De-Koi team, and where the
// rest lives. Every line is credited, through `git blame`, to the commit that
// last changed it, and lands in one of three groups:
//
// - team: written by a De-Koi team member (or a bot), before or after the split
// - marinara: written before the split from Marinara Engine by someone outside the team
// - contributors: written after the split by someone outside the team
//
// "marinara" plus "contributors" is the code that is not yet team-owned.
// See docs/code-provenance-plan.md for why this is tracked.
//
// Usage: node scripts/code-provenance.mjs [options] [paths...]
//   --rev <rev>     Revision to measure (default: HEAD)
//   --fast          Skip following code moved between files (quicker, credits moved code to the mover)
//   --depth <n>     Folder depth for the folder table (default: 3)
//   --top <n>       Rows per table (default: 20)
//   --json <file>   Also write the full per-file and per-author result as JSON
//   paths...        Limit to these paths (default: the whole repository)

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";

// Last commit De-Koi shares with Marinara Engine's `refactor` branch (2026-06-07).
const SPLIT_COMMIT = "cdda626772aa4a5885dd32c3f5a9f2c2a564221b";

// Commit emails of De-Koi team members, lower case. Add an email here when a
// team member commits under a new one.
const TEAM_EMAILS = new Set([
  "294204392+deki-senpai@users.noreply.github.com",
  "32578621+cha1latte@users.noreply.github.com",
  "5384177+decidetto@users.noreply.github.com",
  "celiaafisher@gmail.com",
  "mgmanning93@gmail.com",
  "smax.wikia@live.nl",
  "xelvanas@gmail.com",
  "xelvanis@users.noreply.github.com",
]);
const BOT_EMAIL = /\[bot\]@users\.noreply\.github\.com$/;

// Lockfiles and generated platform projects aren't written by people.
const SKIPPED_PATHS = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)Cargo\.lock$/, /^src-tauri\/gen\//];

// Lines without letters or digits (blank lines, lone brackets) carry no authorship.
const TRIVIAL_LINE = /^[^\p{L}\p{N}]*$/u;

const GROUPS = ["team", "marinara", "contributors"];

// `pnpm report:provenance -- --fast` forwards the "--" itself; drop it so the options still parse.
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

const { values: options, positionals: paths } = parseArgs({
  args,
  options: {
    rev: { type: "string", default: "HEAD" },
    fast: { type: "boolean", default: false },
    depth: { type: "string", default: "3" },
    top: { type: "string", default: "20" },
    json: { type: "string" },
  },
  allowPositionals: true,
});
const depth = Number(options.depth);
const top = Number(options.top);
if (!Number.isInteger(depth) || depth < 1 || !Number.isInteger(top) || top < 1) {
  console.error("--depth and --top must be positive whole numbers.");
  process.exit(1);
}

function git(args, input) {
  const result = spawnSync("git", args, { encoding: "utf8", input, maxBuffer: 1 << 30 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`git ${args.join(" ")} failed:\n${result.stderr.trim()}`);
    process.exit(1);
  }
  return result.stdout;
}

const revCommit = git(["rev-parse", "--verify", `${options.rev}^{commit}`]).trim();
const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", SPLIT_COMMIT, revCommit]);
if (ancestry.status !== 0) {
  console.error(
    `The split commit ${SPLIT_COMMIT.slice(0, 10)} is not in the history of ${options.rev}. ` +
      "This needs a full (not shallow) clone of De-Koi.",
  );
  process.exit(1);
}
const preSplitCommits = new Set(git(["rev-list", SPLIT_COMMIT]).split("\n").filter(Boolean));

// numstat against the empty tree lists every file and marks binary ones with "-".
const emptyTree = git(["hash-object", "-t", "tree", "--stdin"], "").trim();
const files = git(["diff", "--numstat", "-z", "--no-renames", emptyTree, revCommit, "--", ...paths])
  .split("\0")
  .filter(Boolean)
  .map((record) => record.split("\t"))
  .filter(([added]) => added !== "-")
  .map(([, , file]) => file)
  .filter((file) => !SKIPPED_PATHS.some((pattern) => pattern.test(file)));

function groupOf(commit, email) {
  if (TEAM_EMAILS.has(email) || BOT_EMAIL.test(email)) return "team";
  return preSplitCommits.has(commit) ? "marinara" : "contributors";
}

function emptyCounts() {
  return { team: 0, marinara: 0, contributors: 0 };
}

function blame(file) {
  const args = ["blame", "-w", "-M", ...(options.fast ? [] : ["-C", "-C"]), "--line-porcelain", revCommit, "--", file];
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`git blame failed for ${file}:\n${stderr.trim()}`));
    });
  });
}

const totals = emptyCounts();
const fileCounts = {};
const authors = {};

function record(file, output) {
  const counts = emptyCounts();
  let commit = "";
  let name = "";
  let email = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("\t")) {
      if (TRIVIAL_LINE.test(line.slice(1))) continue;
      const group = groupOf(commit, email);
      counts[group] += 1;
      if (group !== "team") {
        authors[email] ??= { name, ...emptyCounts() };
        authors[email][group] += 1;
      }
    } else if (/^[0-9a-f]{40} \d+ \d+/.test(line)) {
      commit = line.slice(0, 40);
    } else if (line.startsWith("author ")) {
      name = line.slice("author ".length);
    } else if (line.startsWith("author-mail ")) {
      email = line.slice("author-mail ".length).replace(/^<|>$/g, "").toLowerCase();
    }
  }
  fileCounts[file] = counts;
  for (const group of GROUPS) totals[group] += counts[group];
}

let next = 0;
let done = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    record(file, await blame(file));
    done += 1;
    if (process.stderr.isTTY && done % 25 === 0) process.stderr.write(`\rBlamed ${done}/${files.length} files`);
  }
}
await Promise.all(Array.from({ length: Math.min(availableParallelism(), files.length) }, worker));
if (process.stderr.isTTY) process.stderr.write("\r\x1b[K");

const notOwned = (counts) => counts.marinara + counts.contributors;
const sum = (counts) => counts.team + counts.marinara + counts.contributors;
const format = (n) => n.toLocaleString("en-US");
const percent = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "-");

const folders = {};
for (const [file, counts] of Object.entries(fileCounts)) {
  const parts = file.split("/").slice(0, -1);
  const folder = parts.slice(0, depth).join("/") || "(root)";
  folders[folder] ??= emptyCounts();
  for (const group of GROUPS) folders[folder][group] += counts[group];
}

function rows(entries) {
  return Object.entries(entries)
    .filter(([, counts]) => notOwned(counts) > 0)
    .sort(([, a], [, b]) => notOwned(b) - notOwned(a))
    .slice(0, top);
}

const total = sum(totals);
const width = 10;
console.log(
  `Code provenance at ${options.rev} (${revCommit.slice(0, 10)}), split from Marinara Engine at ${SPLIT_COMMIT.slice(0, 10)}`,
);
console.log(
  `${format(files.length)} text files, ${format(total)} lines with letters or digits. ` +
    (options.fast
      ? "Fast mode: code moved between files is credited to the mover."
      : "Follows code moved between files."),
);
console.log("");
console.log(`${"lines".padStart(width)}  ${"share".padStart(6)}`);
console.log(`${format(totals.team).padStart(width)}  ${percent(totals.team, total).padStart(6)}  team (and bots)`);
console.log(
  `${format(totals.marinara).padStart(width)}  ${percent(totals.marinara, total).padStart(6)}  Marinara Engine contributors, before the split`,
);
console.log(
  `${format(totals.contributors).padStart(width)}  ${percent(totals.contributors, total).padStart(6)}  other contributors, after the split`,
);
console.log(
  `${format(notOwned(totals)).padStart(width)}  ${percent(notOwned(totals), total).padStart(6)}  not yet team-owned`,
);

console.log(`\nFolders with the most code not yet team-owned (depth ${depth}):`);
console.log(`${"not owned".padStart(width)}  ${"of lines".padStart(width)}  folder`);
for (const [folder, counts] of rows(folders)) {
  console.log(`${format(notOwned(counts)).padStart(width)}  ${format(sum(counts)).padStart(width)}  ${folder}`);
}

console.log("\nFiles with the most code not yet team-owned:");
console.log(`${"not owned".padStart(width)}  ${"of lines".padStart(width)}  file`);
for (const [file, counts] of rows(fileCounts)) {
  console.log(`${format(notOwned(counts)).padStart(width)}  ${format(sum(counts)).padStart(width)}  ${file}`);
}

console.log("\nAuthors of code not yet team-owned:");
console.log(`${"marinara".padStart(width)}  ${"after".padStart(width)}  author`);
for (const [, author] of rows(authors)) {
  console.log(
    `${format(author.marinara).padStart(width)}  ${format(author.contributors).padStart(width)}  ${author.name}`,
  );
}

if (options.json) {
  const result = {
    rev: options.rev,
    revCommit,
    splitCommit: SPLIT_COMMIT,
    generatedAt: new Date().toISOString(),
    followsMovedCode: !options.fast,
    totals,
    folders,
    files: fileCounts,
    authors,
  };
  writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nWrote ${options.json}`);
}
