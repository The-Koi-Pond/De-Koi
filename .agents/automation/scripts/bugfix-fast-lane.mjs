#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evaluateProofHealth } from "./proof-health.mjs";

const [, , command = "help", ledgerPath = "scratch/bugfix-verification.json", ...args] = process.argv;
const gitWarnings = [];

const highRiskPathRules = [
  { name: "dependency declaration", pattern: /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/ },
  { name: "schema or migration", pattern: /(^|\/)(drizzle|migrations?|schema)(\/|\.|$)/i },
  { name: "storage layer", pattern: /(^|\/)(storage|repositories|database|db)(\/|\.|$)/i },
  { name: "import/export path", pattern: /(^|\/)(import|export)(\/|\.|$)/i },
  { name: "version or release metadata", pattern: /(^|\/)(CHANGELOG\.md|android\/app\/build\.gradle|win\/installer\/|packages\/shared\/src\/constants\/defaults\.ts)$/i },
  { name: "prompt pipeline", pattern: /(^|\/)(prompt|prompting|generation|agents?|lorebook)(\/|\.|$)/i },
  { name: "auth or credentials", pattern: /(^|\/)(auth|oauth|credentials?|secrets?)(\/|\.|$)/i },
];

const highRiskFlagPattern = /schema|version|dependency|auth|storage|prompt|external|hardware|credential|unproven|cannot reproduce|force-push|installer|upgrade|legacy|migration|import|export|destructive|compatibility/i;

function usage() {
  console.log(`Usage:
  node .agents/automation/scripts/bugfix-fast-lane.mjs assess <ledger> [--json]
  node .agents/automation/scripts/bugfix-fast-lane.mjs proof <ledger> [--out scratch/bugfix-proof-pack.md]

Purpose:
  assess  Checks whether the current ledger + git state still qualifies for small-bug fast lane.
  proof   Generates a proof block from recorded ledger evidence. Use it in a PR only after an explicit shipping request.

This script does not replace reproduction, verification, matching validation, PR health, or human-only honesty gates.`);
}

function readLedger(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function argValue(name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function hasArg(name) {
  return args.includes(name);
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    gitWarnings.push(stderr || error.message || String(error));
    return "";
  }
}

function normalizePath(path) {
  return String(path ?? "").replaceAll("\\", "/");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function changedFiles() {
  const tracked = git(["diff", "--name-only"]).split(/\r?\n/).filter(Boolean);
  const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean);
  return unique([...tracked, ...staged, ...untracked].map(normalizePath));
}

function productionChangedFiles(files) {
  return files.filter(
    (file) =>
      !file.startsWith("scratch/") &&
      file !== ".agents/automation/scripts/bugfix-fast-lane.mjs",
  );
}

function recordedFiles(ledger) {
  const touched = asArray(ledger.scope?.touchedFiles);
  const intended = asArray(ledger.scope?.intendedFiles);
  return unique([...touched, ...intended].map(normalizePath));
}

function evidenceSummary(items) {
  return asArray(items)
    .map((item) => {
      if (typeof item === "string") return item;
      const bits = [
        item.command,
        item.recipe,
        item.path,
        item.screenshot,
        item.status,
        item.result,
        item.description,
        item.note,
      ].filter(Boolean);
      return bits.join(" - ");
    })
    .filter(Boolean);
}

function includesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function isUiRuntimeLedger(ledger) {
  const explicit = ledger.finalGate?.visualProofRequired;
  if (explicit === true || explicit === false) return explicit;

  const classification = String(ledger.task?.classification ?? "").toLowerCase();
  const taskType = String(ledger.task?.type ?? "").toLowerCase();
  const riskFlags = asArray(ledger.scope?.riskFlags).map((flag) => String(flag).toLowerCase());
  const browserRecipes = asArray(ledger.evidence?.browserRecipes);

  return (
    includesAny(classification, ["ui", "runtime", "browser", "playwright"]) ||
    includesAny(taskType, ["ui", "runtime"]) ||
    riskFlags.some((flag) => includesAny(flag, ["ui", "runtime", "browser", "playwright"])) ||
    browserRecipes.length > 0
  );
}

function evidenceText(items) {
  return asArray(items)
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .join("\n");
}

function uiEvidenceState(ledger) {
  const visualProofText = evidenceText(ledger.evidence?.visualProof);
  const supportingText = evidenceText([
    ...asArray(ledger.evidence?.reproduction),
    ...asArray(ledger.evidence?.verification),
    ...asArray(ledger.evidence?.browserRecipes),
  ]);
  const allText = `${visualProofText}\n${supportingText}`;
  const localScratch = [...allText.matchAll(/(?:^|[\s"'`])(?<path>scratch[\\/][^\s"'`)]+)/gi)].map(
    (match) => match.groups.path,
  );
  const published = /https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/|gist\.github\.com\/|gist\.githubusercontent\.com\/)/i.test(
    visualProofText,
  );
  return { required: isUiRuntimeLedger(ledger), localScratch, published };
}

function assess(ledger) {
  const files = changedFiles();
  const productionFiles = productionChangedFiles(files);
  const recorded = recordedFiles(ledger);
  const unrecorded = productionFiles.filter((file) => !recorded.includes(file));
  const hardStops = asArray(ledger.scope?.hardStops);
  const riskFlags = asArray(ledger.scope?.riskFlags);
  const committedEvidenceFiles = files.filter((file) => file.startsWith("docs/pr-evidence/"));
  const pathRisks = productionFiles.flatMap((file) =>
    highRiskPathRules.filter((rule) => rule.pattern.test(file)).map((rule) => `${rule.name}: ${file}`),
  );
  const flagRisks = riskFlags.filter((flag) => highRiskFlagPattern.test(String(flag)));
  const reproduction = asArray(ledger.evidence?.reproduction);
  const verification = asArray(ledger.evidence?.verification);
  const baselineStatus = ledger.checks?.baselineStatus ?? (ledger.verification?.baselinePassed ? "passed" : "not_run");
  const baselinePassed =
    baselineStatus === "passed" ||
    ledger.verification?.baselinePassed === true ||
    (ledger.verification?.reviewIterationFastPath === true && ledger.verification?.githubValidationPassed === true);
  const originalReproPassed = ledger.verification?.originalReproPassed ?? ledger.finalGate?.coreClaimProven ?? false;
  const proofHealth = evaluateProofHealth(ledger);
  const uiEvidence = uiEvidenceState(ledger);

  const eligibilityBlockers = [
    ...hardStops.map((stop) => `hard stop recorded: ${typeof stop === "string" ? stop : JSON.stringify(stop)}`),
    ...gitWarnings.map((warning) => `git state unavailable: ${warning}`),
    ...committedEvidenceFiles.map((file) => `temporary PR evidence should be uploaded/attached, not committed: ${file}`),
    ...pathRisks,
    ...flagRisks.map((flag) => `high-risk flag: ${flag}`),
  ];

  if (productionFiles.length > 5) {
    eligibilityBlockers.push(`too many production files for fast lane: ${productionFiles.length}`);
  }

  const proofGaps = [];
  if (!ledger.coreClaim) proofGaps.push("coreClaim is not recorded");
  if (reproduction.length === 0) proofGaps.push("no reproduction evidence recorded");
  if (verification.length === 0) proofGaps.push("no after-fix verification evidence recorded");
  if (!originalReproPassed) proofGaps.push("verification.originalReproPassed is not true");
  if (!baselinePassed) proofGaps.push(`baseline status is ${baselineStatus}; expected passed`);
  if (unrecorded.length > 0) proofGaps.push(`unrecorded changed files: ${unrecorded.join(", ")}`);
  if (uiEvidence.required && uiEvidence.localScratch.length > 0 && !uiEvidence.published) {
    proofGaps.push(
      `UI/runtime evidence is still local-only (${unique(uiEvidence.localScratch).join(", ")}); keep it local for local-fix-only work, or upload/attach it to GitHub or a gist and record the URL with publish-evidence.mjs --url before generating shipped PR proof`,
    );
  }
  if (!proofHealth.ready) {
    for (const failure of proofHealth.failures) proofGaps.push(`proofHealth: ${failure}`);
  }

  return {
    eligible: eligibilityBlockers.length === 0,
    readyForPrProof: eligibilityBlockers.length === 0 && proofGaps.length === 0,
    proofHealthRequired: proofHealth.riskRequired,
    proofHealth,
    uiEvidence,
    task: ledger.task ?? {},
    coreClaim: ledger.coreClaim ?? "",
    changedFiles: files,
    productionChangedFiles: productionFiles,
    recordedFiles: recorded,
    eligibilityBlockers,
    proofGaps,
    nextStep:
      eligibilityBlockers.length > 0
        ? "Exit the small-bug fast lane, run proof-health for the risky claim, and report the blocker."
        : proofGaps.length > 0
          ? "Keep the local fast lane, but complete the missing proof before reporting or shipping."
          : "Fast-lane proof is ready; use it locally now or in a draft PR body after an explicit shipping request.",
  };
}

function markdownList(items, fallback = "- Not recorded.") {
  if (!items || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join("\n");
}

function proofMarkdown(ledger, assessment) {
  const task = ledger.task ?? {};
  const reproduction = evidenceSummary(ledger.evidence?.reproduction);
  const verification = evidenceSummary(ledger.evidence?.verification);
  const commands = evidenceSummary(ledger.evidence?.commands);
  const visualProof = evidenceSummary(ledger.evidence?.visualProof);
  const browserRecipes = evidenceSummary(ledger.evidence?.browserRecipes);
  const manualBlockers = asArray(ledger.manualBlockers).map((blocker) =>
    typeof blocker === "string" ? blocker : `${blocker.description}${blocker.verifiedInstead ? `; verified instead: ${blocker.verifiedInstead}` : ""}`,
  );
  const baselineStatus = ledger.checks?.baselineStatus ?? (ledger.verification?.baselinePassed ? "passed" : "not_run");

  return `## AI Bugfix Proof Pack

Task: ${task.title || "Not recorded."}
Classification: ${task.classification || "Not recorded."}

### Fast-lane status

- Eligible: ${assessment.eligible ? "yes" : "no"}
- Ready for PR proof: ${assessment.readyForPrProof ? "yes" : "no"}
- Proof health required: ${assessment.proofHealthRequired ? "yes" : "no"}
- Proof health: ${assessment.proofHealth?.ready ? "ready" : "blocked"}
- Next step: ${assessment.nextStep}

### Core claim

${ledger.coreClaim ? ledger.coreClaim : "Not recorded in ledger yet."}

### Root cause

${ledger.rootCause ? ledger.rootCause : "Not recorded in ledger yet."}

### Changed files

${markdownList(assessment.productionChangedFiles)}

### Reproduction proof

${markdownList(reproduction)}

### Verification proof

${markdownList(verification)}

### Command proof

${markdownList(commands)}

Baseline: \`${ledger.verification?.baselineCommand ?? ledger.checks?.baselineCommand ?? "matching validation command"}\` -> ${baselineStatus}
Baseline evidence: ${ledger.verification?.baselineEvidence || "Not recorded."}

### UI evidence

${markdownList(visualProof)}

### Browser recipes

${markdownList(browserRecipes)}

### Manual blockers

${markdownList(manualBlockers, "- None recorded.")}

### PR health

- PR: ${ledger.pr?.url || ledger.pr?.number || "Not recorded."}
- Checks: ${ledger.pr?.checksStatus || ledger.checks?.ciStatus || "not_recorded"}
- Bunny Review: ${ledger.pr?.bunnyReviewStatus || ledger.checks?.bunnyReviewStatus || ledger.pr?.coderabbitStatus || ledger.checks?.coderabbitStatus || "not_recorded"}
- Health gate: ${ledger.pr?.healthStatus || ledger.checks?.prHealthStatus || "not_recorded"}
- Merged: ${ledger.pr?.merged ? `yes${ledger.pr?.mergeCommit ? ` (${ledger.pr.mergeCommit})` : ""}` : "no"}

### Validation status notes

- Matching validation: ${baselineStatus === "passed" || ledger.verification?.baselinePassed === true ? "Passed locally." : `Not complete: ${baselineStatus}.`}
- Review-iteration fast path: ${ledger.verification?.reviewIterationFastPath ? `Used only for a tiny post-review convention fix; GitHub validation ${ledger.verification?.githubValidationPassed ? "passed" : "has not passed yet"}.` : "Not used."}
- Container (Docker / Podman): ${ledger.checks?.ciStatus === "passed" ? "Covered by GitHub CI container-build-test." : "Not run locally unless recorded separately; explain whether GitHub CI covers it."}
- App click-through: ${browserRecipes.length > 0 ? "Covered by browser recipe evidence above." : "Not applicable unless the bug has user-visible UI behavior."}
- Edge cases: ${verification.length > 0 ? "Covered by the focused repro/verification evidence above; list any additional edge cases separately." : "Not recorded."}
- Manual verification: ${manualBlockers.length === 0 ? "No human-only blocker recorded." : "See manual blockers above."}

### PR validation checklist suggestions

- [ ] Matching validation command passes locally
- [ ] Container (Docker / Podman) built and ran without issue
- [ ] Ran the app, clicked through the changes manually
- [ ] Checked edge cases (light + dark mode, mobile viewport, empty states, error paths)
- [ ] Above manual verification completed (describe below)
- [ ] Read and followed \`CONTRIBUTING.md\`

Leave validation checkboxes unchecked for the human contributor. Put agent-run proof in the notes above, and add \`Not run\`, \`Not applicable\`, or \`Covered by CI\` for checklist items the agent did not cover. UI evidence stays local for local-fix-only work and must be published with \`publish-evidence.mjs\` before a shipped PR cites it.
`;
}

function printAssessment(result) {
  console.log(`Fast-lane eligible: ${result.eligible ? "yes" : "no"}`);
  console.log(`Ready for PR proof: ${result.readyForPrProof ? "yes" : "no"}`);
  console.log(`Next step: ${result.nextStep}`);

  if (result.eligibilityBlockers.length > 0) {
    console.log("\nEligibility blockers:");
    for (const blocker of result.eligibilityBlockers) console.log(`- ${blocker}`);
  }

  if (result.proofGaps.length > 0) {
    console.log("\nProof gaps:");
    for (const gap of result.proofGaps) console.log(`- ${gap}`);
  }

  if (result.productionChangedFiles.length > 0) {
    console.log("\nProduction changed files:");
    for (const file of result.productionChangedFiles) console.log(`- ${file}`);
  }
}

if (command === "help" || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

if (!["assess", "proof"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(2);
}

const ledger = readLedger(ledgerPath);
const result = assess(ledger);

if (command === "assess") {
  if (hasArg("--json")) console.log(JSON.stringify(result, null, 2));
  else printAssessment(result);
  process.exit(result.eligible ? 0 : 1);
}

if (command === "proof") {
  const outPath = argValue("--out", "scratch/bugfix-proof-pack.md");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, proofMarkdown(ledger, result));
  console.log(outPath);
  process.exit(result.readyForPrProof ? 0 : 1);
}
