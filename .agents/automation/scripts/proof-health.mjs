#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { readJsonFile } from "./gh-read.mjs";
import { classifyLedgerRisk } from "./risk-classifier.mjs";

const CONTRADICTION_REQUIRED = [
  "installer",
  "upgrade",
  "legacy",
  "migration",
  "storage",
  "import",
  "export",
  "destructive",
  "delete",
  "backup",
  "user-data",
  "data-loss",
  "compatibility",
  "cross-entrypoint",
  "entrypoint",
  "prompt",
];

const LEGACY_REQUIRED = ["installer", "upgrade", "legacy", "migration", "storage", "compatibility"];
const USER_ACTION_REQUIRED = ["destructive", "delete", "backup", "user-data", "data-loss", "migration", "storage"];
const REVIEWER_ACTION_WORDS = ["bunny", "review", "reviewer", "deci", "thread", "comment"];
const FACT_SOURCE_TYPES = new Set(["measured", "derived", "artifact-derived", "harness-proven"]);
const OWNER_LANES = new Set([
  "src/engine",
  "src/features",
  "src/shared/api",
  "src-tauri",
  "docs/workflow",
  "cross-boundary",
]);
const PRIMARY_OWNER_LANES = [...OWNER_LANES].filter((lane) => lane !== "cross-boundary");

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function includesKeyword(value, keywords) {
  const haystack = text(value).toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function canonicalClaimBoundary(ledger) {
  const matrix = ledger.riskClaimMatrix ?? {};
  return {
    coreClaim: ledger.claimBoundary?.coreClaim ?? matrix.coreClaim ?? ledger.coreClaim ?? "",
    riskType: ledger.claimBoundary?.riskType ?? matrix.riskType ?? "",
    entrypoints: asArray(ledger.claimBoundary?.entrypoints ?? matrix.entrypoints),
    currentPathsOrFormats: asArray(
      ledger.claimBoundary?.currentPathsOrFormats ?? ledger.claimBoundary?.currentPaths ?? matrix.currentPathsOrFormats,
    ),
    legacyPathsOrFormats: asArray(
      ledger.claimBoundary?.legacyPathsOrFormats ?? ledger.claimBoundary?.legacyPaths ?? matrix.legacyPathsOrFormats,
    ),
    outOfScopeClaims: asArray(ledger.claimBoundary?.outOfScopeClaims),
  };
}

function canonicalProofRows(ledger) {
  const matrix = ledger.riskClaimMatrix ?? {};
  return {
    positiveRows: asArray(ledger.proofRows?.positiveRows ?? matrix.positiveRowsTested),
    contradictionRows: asArray(
      ledger.proofRows?.contradictionRows ?? ledger.proofRows?.negativeRows ?? matrix.negativeRowsTested,
    ),
    legacyDefaultRows: asArray(ledger.proofRows?.legacyDefaultRows),
    untestedRows: asArray(ledger.proofRows?.untestedRows),
  };
}

function canonicalOwnedFacts(ledger) {
  const matrixFacts = asArray(ledger.riskClaimMatrix?.groundTruthFacts);
  return [...asArray(ledger.ownedFacts), ...matrixFacts].map((fact) =>
    typeof fact === "string" ? { description: fact } : fact,
  );
}

function canonicalUserActionCopy(ledger) {
  const matrixCopy = asArray(ledger.riskClaimMatrix?.userActionCopy);
  return [...asArray(ledger.userActionCopy), ...matrixCopy].map((item) =>
    typeof item === "string" ? { description: item } : item,
  );
}

function canonicalReviewLedger(ledger) {
  return asArray(ledger.reviewThreadLedger ?? ledger.reviewThreads).map((item) =>
    typeof item === "string" ? { finding: item } : item,
  );
}

function canonicalContractLaneGate(ledger) {
  const gate = ledger.contractLaneGate ?? {};
  return {
    brokenContract: gate.brokenContract ?? "",
    producer: gate.producer ?? "",
    consumer: gate.consumer ?? "",
    impliedContract: gate.impliedContract ?? "",
    actualEnforcement: gate.actualEnforcement ?? "",
    primaryOwnerLane: gate.primaryOwnerLane ?? "",
    primaryOwnerDetail: gate.primaryOwnerDetail ?? "",
    consumerOnlyLanes: asArray(gate.consumerOnlyLanes),
    wrongLaneFixToAvoid: gate.wrongLaneFixToAvoid ?? "",
    regressionProof: asArray(gate.regressionProof),
  };
}

function requiresAnyKeyword(boundary, keywords) {
  return includesKeyword(
    [
      boundary.riskType,
      boundary.coreClaim,
      ...boundary.entrypoints,
      ...boundary.currentPathsOrFormats,
      ...boundary.legacyPathsOrFormats,
    ],
    keywords,
  );
}

function hasUsefulCopyInstruction(item) {
  const hasStructured =
    item?.source &&
    item?.destination &&
    (item?.files || item?.folders || item?.paths) &&
    (item?.action || item?.backupAction || item?.copyAction);
  const prose = text(item);
  const hasProse =
    /\b(copy|back up|backup|move|export)\b/i.test(prose) &&
    /\b(to|destination|into)\b/i.test(prose) &&
    /[A-Za-z]:\\|\.json|\.db|\.sqlite|\/|\\/.test(prose);
  return Boolean(hasStructured || hasProse);
}

function hasReviewDisposition(item) {
  const disposition = item?.disposition ?? item?.classification ?? "";
  const action = item?.fix ?? item?.defer ?? item?.pushback ?? item?.commit ?? item?.reason ?? "";
  return Boolean(item?.finding && disposition && action);
}

function manualBlockerFailures(manualBlockers) {
  return asArray(manualBlockers).flatMap((blocker, index) => {
    if (blocker && typeof blocker === "object" && "blockingCoreClaim" in blocker) return [];
    return [`manualBlockers[${index}] must state blockingCoreClaim true/false`];
  });
}

function hasContent(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(hasContent);
  return true;
}

function isProofSectionPresent(ledger) {
  return Boolean(
    hasContent(ledger.claimBoundary) ||
      hasContent(ledger.riskClaimMatrix) ||
      hasContent(ledger.proofRows) ||
      hasContent(ledger.ownedFacts) ||
      hasContent(ledger.userActionCopy) ||
      hasContent(ledger.reviewThreadLedger) ||
      hasContent(ledger.reviewThreads),
  );
}

function hasContractLaneGateContent(gate) {
  return hasContent(gate);
}

function validateContractLaneGate(gate, required) {
  if (!required) return [];

  const failures = [];
  const requiredFields = [
    ["brokenContract", "contractLaneGate.brokenContract is required for risky boundary work"],
    ["producer", "contractLaneGate.producer is required for risky boundary work"],
    ["consumer", "contractLaneGate.consumer is required for risky boundary work"],
    ["impliedContract", "contractLaneGate.impliedContract is required for risky boundary work"],
    ["actualEnforcement", "contractLaneGate.actualEnforcement is required for risky boundary work"],
    ["primaryOwnerLane", "contractLaneGate.primaryOwnerLane is required for risky boundary work"],
    ["wrongLaneFixToAvoid", "contractLaneGate.wrongLaneFixToAvoid is required for risky boundary work"],
  ];

  for (const [field, message] of requiredFields) {
    if (!text(gate[field]).trim()) failures.push(message);
  }

  if (gate.regressionProof.length === 0) {
    failures.push("contractLaneGate.regressionProof must name at least one required regression proof row");
  }

  if (gate.consumerOnlyLanes.some((lane) => !OWNER_LANES.has(lane))) {
    failures.push(`contractLaneGate.consumerOnlyLanes must use canonical lanes: ${[...OWNER_LANES].join(", ")}`);
  }

  if (gate.primaryOwnerLane && !OWNER_LANES.has(gate.primaryOwnerLane)) {
    failures.push(`contractLaneGate.primaryOwnerLane must be one of: ${[...OWNER_LANES].join(", ")}`);
  }

  if (gate.primaryOwnerLane === "cross-boundary") {
    const ownerText = text([gate.primaryOwnerDetail, gate.brokenContract, gate.impliedContract]);
    if (!PRIMARY_OWNER_LANES.some((lane) => ownerText.includes(lane))) {
      failures.push(
        "contractLaneGate.primaryOwnerDetail, brokenContract, or impliedContract must name the primary owning lane when primaryOwnerLane is cross-boundary",
      );
    }
  }

  if (gate.primaryOwnerLane === "src-tauri" && !text(gate.wrongLaneFixToAvoid).trim()) {
    failures.push("contractLaneGate.wrongLaneFixToAvoid must explain why src-tauri owns native mechanics, not product meaning");
  }

  return failures;
}

export function evaluateProofHealth(ledger) {
  const failures = [];
  const warnings = [];
  const risk = classifyLedgerRisk(ledger);
  const signals = risk.signals;
  const boundary = canonicalClaimBoundary(ledger);
  const proofRows = canonicalProofRows(ledger);
  const ownedFacts = canonicalOwnedFacts(ledger);
  const userActionCopy = canonicalUserActionCopy(ledger);
  const reviewThreadLedger = canonicalReviewLedger(ledger);
  const contractLaneGate = canonicalContractLaneGate(ledger);
  const riskRequired = risk.required || isProofSectionPresent(ledger);
  const contractGateRequired = riskRequired || hasContractLaneGateContent(ledger.contractLaneGate);

  failures.push(...manualBlockerFailures(ledger.manualBlockers));
  failures.push(...validateContractLaneGate(contractLaneGate, contractGateRequired));

  if (!riskRequired) {
    return {
      ready: failures.length === 0,
      riskRequired: false,
      contractGateRequired,
      risk,
      riskSignals: signals,
      warnings,
      failures,
      claimBoundary: boundary,
      proofRows,
      ownedFacts,
      userActionCopy,
      reviewThreadLedger,
      contractLaneGate,
    };
  }

  if (!boundary.coreClaim) failures.push("claimBoundary.coreClaim is required for risky work");
  if (!boundary.riskType) failures.push("claimBoundary.riskType is required for risky work");
  if (boundary.entrypoints.length === 0) failures.push("claimBoundary.entrypoints must name affected entrypoints");
  if (boundary.currentPathsOrFormats.length === 0) {
    failures.push("claimBoundary.currentPathsOrFormats must name current paths/formats");
  }
  if (proofRows.positiveRows.length === 0) failures.push("proofRows.positiveRows must prove at least one intended path");

  if (requiresAnyKeyword(boundary, CONTRADICTION_REQUIRED) && proofRows.contradictionRows.length === 0) {
    failures.push("proofRows.contradictionRows must include at least one should-not-match or contradiction row");
  }

  if (requiresAnyKeyword(boundary, LEGACY_REQUIRED) && boundary.legacyPathsOrFormats.length === 0) {
    failures.push("claimBoundary.legacyPathsOrFormats is required for legacy/upgrade/storage/installer/compatibility work");
  }

  if (requiresAnyKeyword(boundary, LEGACY_REQUIRED) && proofRows.legacyDefaultRows.length === 0) {
    failures.push("proofRows.legacyDefaultRows must cover adjacent legacy/default paths");
  }

  for (const [index, fact] of ownedFacts.entries()) {
    if (!fact?.description && !fact?.fact) failures.push(`ownedFacts[${index}] must describe the app/installer-owned fact`);
    if (!FACT_SOURCE_TYPES.has(fact?.sourceType)) {
      failures.push(
        `ownedFacts[${index}] must use sourceType measured, derived, artifact-derived, or harness-proven`,
      );
    }
    if (!fact?.evidence) failures.push(`ownedFacts[${index}] must cite local measurement/derivation/harness evidence`);
  }

  if (requiresAnyKeyword(boundary, USER_ACTION_REQUIRED) && userActionCopy.length === 0) {
    failures.push("userActionCopy must give exact copy/backup/destructive-action instructions when user data is at risk");
  }
  for (const [index, copy] of userActionCopy.entries()) {
    if (!hasUsefulCopyInstruction(copy)) {
      failures.push(`userActionCopy[${index}] must name exact source, destination, action, and files/folders`);
    }
    if (!copy?.detectedLayouts && !copy?.layouts && !/current|legacy/i.test(text(copy))) {
      warnings.push(`userActionCopy[${index}] should record current/legacy detected layouts when applicable`);
    }
  }

  const reviewerEvidencePresent =
    reviewThreadLedger.length > 0 ||
    includesKeyword([...asArray(ledger.scope?.riskFlags), ...asArray(ledger.notes)], REVIEWER_ACTION_WORDS);
  if (reviewerEvidencePresent) {
    for (const [index, thread] of reviewThreadLedger.entries()) {
      if (!hasReviewDisposition(thread)) {
        failures.push(`reviewThreadLedger[${index}] must include finding, disposition/classification, and fix/defer/pushback`);
      }
      if (!("humanResolved" in thread) && !("humanResolutionRequired" in thread)) {
        warnings.push(`reviewThreadLedger[${index}] should state whether human resolution remains`);
      }
    }
  }

  if (proofRows.untestedRows.length > 0) {
    warnings.push(`untested proof rows recorded: ${proofRows.untestedRows.length}`);
  }

  return {
    ready: failures.length === 0,
    riskRequired: true,
    contractGateRequired,
    risk,
    riskSignals: signals,
    warnings,
    failures,
    claimBoundary: boundary,
    proofRows,
    ownedFacts,
    userActionCopy,
    reviewThreadLedger,
    contractLaneGate,
  };
}

function printText(result) {
  console.log(`Proof health: ${result.ready ? "ready" : "blocked"}`);
  console.log(`Risk proof required: ${result.riskRequired ? "yes" : "no"}`);
  if (result.riskSignals.length > 0) {
    console.log("\nRisk signals:");
    for (const signal of result.riskSignals) console.log(`- ${signal}`);
  }
  if (result.failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of result.failures) console.log(`- ${failure}`);
  }
  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
}

function usage() {
  console.log(`Usage:
  node .agents/automation/scripts/proof-health.mjs <ledger> [--json]

Validates claim-proof quality for risky work. Low-risk ledgers can pass without
the heavy proof section; risky ledgers must record the contract lane gate, bound
the claim, prove positive and contradiction rows, ground app-owned facts, and
preserve reviewer dispositions.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , ledgerPath, ...args] = process.argv;
  if (!ledgerPath || ledgerPath === "--help" || ledgerPath === "-h") {
    usage();
    process.exit(ledgerPath ? 0 : 2);
  }

  const warnings = [];
  const failures = [];
  const ledger = readJsonFile(ledgerPath, {
    warnings,
    failures,
    context: "proof ledger",
    required: true,
  });
  if (!ledger) {
    const result = { ready: false, riskRequired: null, riskSignals: [], warnings, failures };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const result = evaluateProofHealth(ledger);
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  process.exit(result.ready ? 0 : 1);
}
