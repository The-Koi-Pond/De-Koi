// Keeps the Windows Rust Tests workflow's pull_request paths covering every
// Rust file with Windows-sensitive code, so new process, console or lock code
// cannot land without the Windows lane running on its pull request.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WORKFLOW = ".github/workflows/windows-rust.yml";

// Code whose behavior differs on Windows: child processes and their console
// flags, process trees, file locks, and (below) any cfg predicate naming Windows.
const WINDOWS_SENSITIVE_PATTERNS = [
  /target_os\s*=\s*"windows"/,
  /\bwindows_sys\b|\bwinapi\b/,
  /\bCREATE_NO_WINDOW\b|\bJobObject\w*/,
  /\bCommand::new\b|\bstd::process::Command\b|\btokio::process\b/,
  /\bfs2::|\bfd_lock\b|\block_exclusive\(/,
];

/**
 * The predicates of every `cfg(...)`, `cfg!(...)` and `cfg_attr(...)` in the
 * source, read with balanced parentheses so nested forms such as
 * `cfg(all(not(unix), windows))` are seen whole. For `cfg_attr` only the first
 * argument is the predicate; the attributes after it are not.
 */
function cfgPredicates(source) {
  const predicates = [];
  for (const match of source.matchAll(/\bcfg(_attr)?!?\s*\(/g)) {
    const isAttr = Boolean(match[1]);
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    let end = -1;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 1 && isAttr && end < 0) end = index;
      index += 1;
    }
    predicates.push(source.slice(start, end >= 0 ? end : index - 1));
  }
  return predicates;
}

export function isWindowsSensitive(source) {
  return (
    WINDOWS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(source)) ||
    cfgPredicates(source).some((predicate) => /\bwindows\b/.test(predicate))
  );
}

/** The `on.pull_request.paths` entries of a workflow file. */
export function pullRequestPaths(workflow) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => /^ {2}pull_request:\s*$/.test(line));
  if (start < 0) return [];
  const paths = [];
  let inPaths = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || /^ {2}\S/.test(line)) break;
    if (/^ {4}paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) inPaths = false;
    const entry = inPaths ? line.match(/^ {6}- (.+?)\s*$/) : null;
    if (entry) paths.push(entry[1].replace(/^["']|["']$/g, ""));
  }
  return paths;
}

/** GitHub path filter glob to a RegExp: `**` spans folders, `*` stays inside one. */
export function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      pattern += ".*";
      index += 1;
      if (glob[index + 1] === "/") index += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Windows-sensitive files the workflow's pull_request paths do not cover. */
export function uncoveredFiles(files, paths) {
  const matchers = paths.map(globToRegExp);
  return [...files.entries()]
    .filter(([, source]) => isWindowsSensitive(source))
    .map(([file]) => file)
    .filter((file) => !matchers.some((matcher) => matcher.test(file)))
    .sort();
}

/** Workflow paths that match no tracked file, for example after a rename. */
export function stalePaths(paths, trackedFiles) {
  return paths.filter((path) => !trackedFiles.some((file) => globToRegExp(path).test(file)));
}

function trackedFiles(pathspec) {
  const result = spawnSync("git", ["ls-files", "-z", "--", ...pathspec], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout.split("\0").filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = pullRequestPaths(readFileSync(WORKFLOW, "utf8"));
  const files = new Map(trackedFiles(["src-tauri/*.rs"]).map((file) => [file, readFileSync(file, "utf8")]));
  const missing = uncoveredFiles(files, paths);
  const stale = stalePaths(paths, trackedFiles(["."]));
  if (missing.length > 0) {
    console.error(
      `These Rust files have Windows-sensitive code but ${WORKFLOW} does not run for pull requests that change them.\n` +
        `Add a path under on.pull_request.paths that covers each:\n` +
        missing.map((file) => `  ${file}`).join("\n"),
    );
  }
  if (stale.length > 0) {
    console.error(
      `These ${WORKFLOW} pull_request paths match no tracked file:\n` + stale.map((path) => `  ${path}`).join("\n"),
    );
  }
  if (missing.length > 0 || stale.length > 0) process.exit(1);
  const sensitive = [...files.values()].filter(isWindowsSensitive).length;
  console.log(
    `Windows Rust Tests runs on pull requests touching any of the ${sensitive} Windows-sensitive Rust files.`,
  );
}
