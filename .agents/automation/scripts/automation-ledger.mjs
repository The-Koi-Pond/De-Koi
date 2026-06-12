#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evaluateProofHealth } from "./proof-health.mjs";

const [, , command = "help", file = "scratch/automation-ledger.json", ...args] = process.argv;

const template = {
  schemaVersion: 1,
  task: {
    type: "",
    title: "",
    source: "",
    classification: "",
    status: "in_progress",
  },
  run: {
    startedAt: "",
    finishedAt: "",
    elapsedMinutes: null,
    reasoningEffort: "",
    budget: "",
    costNotes: "",
  },
  trace: [],
  coreClaim: "",
  rootCause: "",
  scope: {
    intendedFiles: [],
    touchedFiles: [],
    riskFlags: [],
    hardStops: [],
  },
  evidence: {
    reproduction: [],
    verification: [],
    visualProof: [],
    commands: [],
    browserRecipes: [],
  },
  verification: {
    originalReproPassed: false,
    focusedReproPassed: false,
    baselinePassed: false,
    baselineCommand: "matching validation command",
    baselineEvidence: "",
    githubValidationPassed: false,
    reviewIterationFastPath: false,
  },
  checks: {
    baselineCommand: "matching validation command",
    baselineStatus: "not_run",
    versionCheckStatus: "not_applicable",
    dbPushStatus: "not_applicable",
    ciStatus: "not_applicable",
    bunnyReviewStatus: "not_applicable",
    prHealthStatus: "not_applicable",
  },
  manualBlockers: [],
  claimBoundary: {
    coreClaim: "",
    riskType: "",
    entrypoints: [],
    currentPathsOrFormats: [],
    legacyPathsOrFormats: [],
    outOfScopeClaims: [],
  },
  contractLaneGate: {
    brokenContract: "",
    producer: "",
    consumer: "",
    impliedContract: "",
    actualEnforcement: "",
    primaryOwnerLane: "",
    primaryOwnerDetail: "",
    consumerOnlyLanes: [],
    wrongLaneFixToAvoid: "",
    regressionProof: [],
  },
  proofRows: {
    positiveRows: [],
    contradictionRows: [],
    legacyDefaultRows: [],
    untestedRows: [],
  },
  ownedFacts: [],
  userActionCopy: [],
  reviewThreadLedger: [],
  externalActions: [],
  pr: {
    number: null,
    url: "",
    headRefName: "",
    baseRefName: "",
    healthStatus: "not_applicable",
    bunnyReviewStatus: "not_applicable",
    checksStatus: "not_applicable",
    merged: false,
    mergeCommit: "",
  },
  finalGate: {
    coreClaimProven: false,
    visualProofPresent: false,
    visualProofRequired: null,
    diffFocused: false,
    noUnapprovedExternalText: true,
    readyToReportDone: false,
  },
  finalDoneGate: {
    bugfixComplete: false,
    prClean: false,
    bunnyReviewClean: false,
    requiredChecksPassed: false,
    readyOrMerged: false,
    noBlockingManualVerification: false,
    reportOnlyWhenComplete: true,
  },
  notes: [],
};

function usage() {
  console.log(`Usage:
  node .agents/automation/scripts/automation-ledger.mjs init <file> key=value ...
  node .agents/automation/scripts/automation-ledger.mjs start <file> key=value ...
  node .agents/automation/scripts/automation-ledger.mjs set <file> key=value ...
  node .agents/automation/scripts/automation-ledger.mjs append <file> path=value ...
  node .agents/automation/scripts/automation-ledger.mjs event <file> phase=... action=... outcome=... evidence=...
  node .agents/automation/scripts/automation-ledger.mjs finish <file> status=...
  node .agents/automation/scripts/automation-ledger.mjs validate <file>

Examples:
  node .agents/automation/scripts/automation-ledger.mjs init scratch/feature-ledger.json task.type=feature task.title="Favorites"
  node .agents/automation/scripts/automation-ledger.mjs start scratch/feature-ledger.json run.reasoningEffort=adaptive-high run.budget="focused local fix"
  node .agents/automation/scripts/automation-ledger.mjs event scratch/feature-ledger.json phase=verify action="pnpm typecheck" outcome=passed evidence=scratch/check.txt
  node .agents/automation/scripts/automation-ledger.mjs finish scratch/feature-ledger.json status=complete
  node .agents/automation/scripts/automation-ledger.mjs append scratch/feature-ledger.json evidence.commands='{"command":"pnpm typecheck","status":"passed"}'
`);
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseUpdates(rawArgs) {
  const updates = [];
  for (const arg of rawArgs) {
    const eq = arg.indexOf("=");
    if (eq === -1) continue;
    updates.push([arg.slice(0, eq), parseValue(arg.slice(eq + 1))]);
  }
  return updates;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeShortcutPath(path, command) {
  if (path === "status" && command === "finish") return "task.status";
  if (path === "reasoningEffort") return "run.reasoningEffort";
  if (path === "budget") return "run.budget";
  if (path === "costNotes") return "run.costNotes";
  return path;
}

function getPath(target, path) {
  return path.split(".").reduce((cursor, part) => (cursor == null ? undefined : cursor[part]), target);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function appendPath(target, path, value) {
  const existing = getPath(target, path);
  if (existing === undefined) {
    setPath(target, path, [value]);
    return;
  }
  if (!Array.isArray(existing)) {
    throw new Error(`${path} exists but is not an array`);
  }
  existing.push(value);
}

function traceEvent(updates, defaults = {}) {
  const event = { timestamp: nowIso(), ...defaults };
  for (const [path, value] of updates) {
    setPath(event, path, value);
  }
  return event;
}

function readLedger(path) {
  try {
    return mergeTemplate(JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")));
  } catch {
    return structuredClone(template);
  }
}

function mergeTemplate(value) {
  return {
    ...structuredClone(template),
    ...value,
    task: { ...template.task, ...(value.task ?? {}) },
    run: { ...template.run, ...(value.run ?? {}) },
    trace: Array.isArray(value.trace) ? value.trace : [],
    scope: { ...template.scope, ...(value.scope ?? {}) },
    evidence: { ...template.evidence, ...(value.evidence ?? {}) },
    verification: { ...template.verification, ...(value.verification ?? {}) },
    checks: { ...template.checks, ...(value.checks ?? {}) },
    claimBoundary: { ...template.claimBoundary, ...(value.claimBoundary ?? {}) },
    contractLaneGate: { ...template.contractLaneGate, ...(value.contractLaneGate ?? {}) },
    proofRows: { ...template.proofRows, ...(value.proofRows ?? {}) },
    pr: { ...template.pr, ...(value.pr ?? {}) },
    finalGate: { ...template.finalGate, ...(value.finalGate ?? {}) },
    finalDoneGate: { ...template.finalDoneGate, ...(value.finalDoneGate ?? {}) },
  };
}

function writeLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(path);
}

function validate(ledger) {
  const failures = [];
  const blockingManual = Array.isArray(ledger.manualBlockers)
    ? ledger.manualBlockers.some((blocker) => blocker?.blockingCoreClaim === true)
    : false;
  const visualProofRequired = requiresVisualProof(ledger);

  if (!ledger.task?.type) failures.push("task.type is required");
  if (!ledger.task?.title) failures.push("task.title is required");
  if (!ledger.coreClaim && ledger.task?.type === "bugfix") failures.push("coreClaim is required for bugfix ledgers");
  if (!ledger.finalGate?.diffFocused) failures.push("finalGate.diffFocused must be true");
  if (!ledger.finalGate?.noUnapprovedExternalText) failures.push("finalGate.noUnapprovedExternalText must be true");
  if (!ledger.finalGate?.coreClaimProven && !blockingManual) {
    failures.push("finalGate.coreClaimProven must be true unless a blocking manual blocker is recorded");
  }
  if (visualProofRequired && !ledger.finalGate?.visualProofPresent && !blockingManual) {
    failures.push("finalGate.visualProofPresent must be true for UI/runtime tasks unless a blocking manual blocker is recorded");
  }
  if (ledger.checks?.baselineStatus !== "passed" && ledger.verification?.baselinePassed !== true && !blockingManual) {
    failures.push("checks.baselineStatus must be passed or verification.baselinePassed must be true unless a blocking manual blocker is recorded");
  }
  if (!ledger.finalGate?.readyToReportDone) failures.push("finalGate.readyToReportDone must be true");

  if (ledger.task?.type === "bugfix" && ledger.finalGate?.readyToReportDone) {
    if (!ledger.finalDoneGate?.bugfixComplete && !blockingManual) failures.push("finalDoneGate.bugfixComplete must be true");
    if (!ledger.finalDoneGate?.noBlockingManualVerification && !blockingManual) {
      failures.push("finalDoneGate.noBlockingManualVerification must be true unless a blocking manual blocker is recorded");
    }
  }

  const proofHealth = evaluateProofHealth(ledger);
  if (!proofHealth.ready) {
    for (const failure of proofHealth.failures) failures.push(`proofHealth: ${failure}`);
  }

  return failures;
}

function includesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function requiresVisualProof(ledger) {
  const explicit = ledger.finalGate?.visualProofRequired;
  if (explicit === true || explicit === false) return explicit;

  const classification = String(ledger.task?.classification ?? "").toLowerCase();
  const taskType = String(ledger.task?.type ?? "").toLowerCase();
  const riskFlags = Array.isArray(ledger.scope?.riskFlags)
    ? ledger.scope.riskFlags.map((flag) => String(flag).toLowerCase())
    : [];
  const browserRecipes = Array.isArray(ledger.evidence?.browserRecipes) ? ledger.evidence.browserRecipes : [];

  return (
    includesAny(classification, ["ui", "runtime", "browser", "playwright"]) ||
    includesAny(taskType, ["ui", "runtime"]) ||
    riskFlags.some((flag) => includesAny(flag, ["ui", "runtime", "browser", "playwright"])) ||
    browserRecipes.length > 0
  );
}

if (command === "help" || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

if (!["init", "start", "set", "append", "event", "finish", "validate"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(2);
}

const ledger = command === "init" ? structuredClone(template) : readLedger(file);

if (command === "init" || command === "set") {
  for (const [path, value] of parseUpdates(args)) setPath(ledger, path, value);
  writeLedger(file, ledger);
} else if (command === "start") {
  const updates = parseUpdates(args);
  for (const [path, value] of updates) setPath(ledger, normalizeShortcutPath(path, command), value);
  if (!ledger.run.startedAt) ledger.run.startedAt = nowIso();
  if (!ledger.task.status || ledger.task.status === "not_started") ledger.task.status = "in_progress";
  appendPath(
    ledger,
    "trace",
    traceEvent(updates, { phase: "run", action: "start", outcome: ledger.task.status }),
  );
  writeLedger(file, ledger);
} else if (command === "append") {
  for (const [path, value] of parseUpdates(args)) appendPath(ledger, path, value);
  writeLedger(file, ledger);
} else if (command === "event") {
  appendPath(ledger, "trace", traceEvent(parseUpdates(args)));
  writeLedger(file, ledger);
} else if (command === "finish") {
  const updates = parseUpdates(args);
  const hasStatusUpdate = updates.some(([path]) => path === "status" || path === "task.status");
  for (const [path, value] of updates) setPath(ledger, normalizeShortcutPath(path, command), value);
  if (!ledger.run.finishedAt) ledger.run.finishedAt = nowIso();
  if (!hasStatusUpdate && (!ledger.task.status || ledger.task.status === "in_progress")) ledger.task.status = "complete";
  const started = Date.parse(ledger.run.startedAt);
  const finished = Date.parse(ledger.run.finishedAt);
  if (Number.isFinite(started) && Number.isFinite(finished)) {
    ledger.run.elapsedMinutes = Math.round(((finished - started) / 60000) * 100) / 100;
  }
  appendPath(
    ledger,
    "trace",
    traceEvent(updates, { phase: "run", action: "finish", outcome: ledger.task.status }),
  );
  writeLedger(file, ledger);
} else if (command === "validate") {
  const failures = validate(ledger);
  if (failures.length > 0) {
    console.error("Automation ledger is not complete yet:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Automation ledger done gate passed.");
}
