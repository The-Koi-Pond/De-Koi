#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

function usage() {
  console.log(`Usage:
  node .agents/automation/scripts/publish-evidence.mjs --url <github-or-gist-url> [...] [--ledger <path>]
  node .agents/automation/scripts/publish-evidence.mjs <issue-number-or-slug> <screenshot-or-proof> [...] [--ledger <path>] --allow-committed-evidence

Records reviewer-visible proof URLs in the ledger after screenshots are uploaded
or attached to GitHub/a gist. Temporary PR proof screenshots should stay under
scratch/ and should not be committed under docs/pr-evidence/.

The file-copy mode is retained only for intentional docs/reference assets and
requires --allow-committed-evidence.`);
}

function parseArgs(argv) {
  const options = {
    issueOrSlug: null,
    sourcePaths: [],
    ledger: null,
    urls: [],
    description: null,
    allowCommittedEvidence: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--ledger") {
      options.ledger = optionValue(argv, index, "--ledger");
      index += 1;
      continue;
    }
    if (arg === "--url") {
      options.urls.push(optionValue(argv, index, "--url"));
      index += 1;
      continue;
    }
    if (arg === "--description") {
      options.description = optionValue(argv, index, "--description");
      index += 1;
      continue;
    }
    if (arg === "--allow-committed-evidence") {
      options.allowCommittedEvidence = true;
      continue;
    }
    if (!options.issueOrSlug) options.issueOrSlug = arg;
    else options.sourcePaths.push(arg);
  }
  options.urls = options.urls.filter(Boolean);
  return options;
}

function optionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function safeEvidenceSlug(value) {
  const slug = String(value ?? "")
    .replace(/^#/, "issue-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug === "." || slug === ".." || !/[a-zA-Z0-9]/.test(slug)) {
    throw new Error("Evidence slug must include at least one alphanumeric character and cannot be . or ..");
  }
  return slug;
}

function updateLedger(ledgerPath, evidence) {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8").replace(/^\uFEFF/, ""));
  ledger.evidence ??= {};
  ledger.evidence.visualProof ??= [];
  ledger.finalGate ??= {};
  ledger.trace ??= [];

  for (const proof of evidence) {
    ledger.evidence.visualProof.push({
      status: "published",
      ...proof,
    });
  }

  ledger.finalGate.visualProofPresent = true;
  ledger.trace.push({
    timestamp: new Date().toISOString(),
    phase: "evidence",
    action: "publish-evidence",
    outcome: "published",
    evidence,
  });

  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  usage();
  process.exit(0);
}

if (options.urls.length === 0 && (!options.issueOrSlug || options.sourcePaths.length === 0)) {
  usage();
  process.exit(2);
}

const evidence = options.urls.map((url) => ({
  url,
  description: options.description ?? `Published reviewer-visible proof at ${url}`,
}));

const copied = [];
let targetDir = null;
if (options.sourcePaths.length > 0) {
  if (!options.allowCommittedEvidence) {
    console.error(
      "Refusing to copy temporary proof screenshots into docs/pr-evidence. Upload/attach the files to GitHub or a gist, then rerun with --url <published-url>. Use --allow-committed-evidence only for intentional docs/reference assets.",
    );
    process.exit(3);
  }

  const safeSlug = safeEvidenceSlug(options.issueOrSlug);
  const evidenceRoot = resolve("docs", "pr-evidence");
  targetDir = resolve(evidenceRoot, safeSlug);
  const relativeTargetDir = relative(evidenceRoot, targetDir);
  if (
    !relativeTargetDir ||
    relativeTargetDir === ".." ||
    relativeTargetDir.startsWith(`..${sep}`) ||
    isAbsolute(relativeTargetDir)
  ) {
    throw new Error("Evidence target directory escaped docs/pr-evidence");
  }
  mkdirSync(targetDir, { recursive: true });

  for (const sourcePath of options.sourcePaths) {
    const stats = statSync(sourcePath);
    if (!stats.isFile()) throw new Error(`${sourcePath} is not a file`);

    const targetPath = join(targetDir, basename(sourcePath));
    const normalizedTargetPath = relative(".", targetPath).replaceAll("\\", "/");
    copyFileSync(sourcePath, targetPath);
    copied.push(normalizedTargetPath);
    evidence.push({
      path: normalizedTargetPath,
      description: options.description ?? `Committed reviewer-visible proof at ${normalizedTargetPath}`,
    });
  }
}

if (options.ledger) updateLedger(options.ledger, evidence);

console.log(
  JSON.stringify(
    {
      targetDir: targetDir ? targetDir.replaceAll("\\", "/") : null,
      copied,
      urls: options.urls,
      ledger: options.ledger,
    },
    null,
    2,
  ),
);
