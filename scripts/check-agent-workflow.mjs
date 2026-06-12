import { evaluateProofHealth } from "../.agents/automation/scripts/proof-health.mjs";
import { execFileSync } from "node:child_process";

const riskyMissingGate = {
  task: { type: "bugfix", title: "Risky provider boundary fixture" },
  claimBoundary: {
    coreClaim: "Provider auth errors are sanitized before display.",
    riskType: "auth provider error",
    entrypoints: ["connection test", "message send"],
    currentPathsOrFormats: ["provider error response"],
  },
  proofRows: {
    positiveRows: ["invalid auth returns a sanitized message"],
    contradictionRows: ["synthetic API key is not present in the UI error"],
  },
  manualBlockers: [],
};

const completeGate = {
  task: { type: "bugfix", title: "Risky provider boundary fixture" },
  claimBoundary: riskyMissingGate.claimBoundary,
  contractLaneGate: {
    brokenContract: "Provider transport can return unsafe auth text across the runtime boundary.",
    producer: "src-tauri provider transport",
    consumer: "src/shared/api and src/features connection UI",
    impliedContract: "User-facing errors are safe to display.",
    actualEnforcement: "Provider text is passed through without a Marinara-owned redaction gate.",
    primaryOwnerLane: "cross-boundary",
    primaryOwnerDetail: "src-tauri owns transport redaction mechanics; src/shared/api owns normalized client error shape.",
    consumerOnlyLanes: ["src/features"],
    wrongLaneFixToAvoid: "Do not redact only in the toast or connection form.",
    regressionProof: ["invalid auth error redacts a short synthetic key"],
  },
  proofRows: riskyMissingGate.proofRows,
  manualBlockers: [],
};

const lowRiskMissingGate = {
  task: { type: "docs", title: "Low-risk copy fixture" },
  manualBlockers: [],
};

const srcTauriMissingWrongLane = {
  ...completeGate,
  claimBoundary: {
    coreClaim: "Image uploads reject non-image bytes.",
    riskType: "storage upload",
    entrypoints: ["image upload"],
    currentPathsOrFormats: ["declared image MIME payload"],
    legacyPathsOrFormats: ["existing upload payloads"],
  },
  contractLaneGate: {
    brokenContract: "Upload accepts declared image MIME without validating bytes.",
    producer: "src/features upload UI",
    consumer: "src-tauri upload decoder",
    impliedContract: "Accepted upload payloads contain valid image bytes.",
    actualEnforcement: "Declared MIME and size are checked but bytes are not decoded.",
    primaryOwnerLane: "src-tauri",
    consumerOnlyLanes: ["src/shared/api", "src/features"],
    wrongLaneFixToAvoid: "",
    regressionProof: ["declared image MIME with text bytes is rejected"],
  },
  proofRows: {
    positiveRows: ["valid image bytes are accepted"],
    contradictionRows: ["declared image MIME with text bytes is rejected"],
    legacyDefaultRows: ["existing valid upload payloads still pass"],
  },
  userActionCopy: [
    {
      source: "C:\\Users\\Example\\Pictures\\bad.txt",
      destination: "not persisted",
      files: ["bad.txt"],
      action: "reject before storage",
      detectedLayouts: ["current upload payload"],
    },
  ],
};

const crossBoundaryMissingDetail = {
  ...srcTauriMissingWrongLane,
  claimBoundary: {
    coreClaim: "Generic lorebook entry writes normalize booleans.",
    riskType: "storage compatibility",
    entrypoints: ["storage_create", "storage_update"],
    currentPathsOrFormats: ["lorebook-entries"],
    legacyPathsOrFormats: ["legacy string boolean rows"],
  },
  contractLaneGate: {
    brokenContract: "Generic writes can persist malformed lorebook-entry fields.",
    producer: "generic storage callers",
    consumer: "prompt activation and lorebook editor",
    impliedContract: "Stored lorebook entries have normalized booleans and arrays.",
    actualEnforcement: "Only the legacy import path normalizes the shape.",
    primaryOwnerLane: "cross-boundary",
    consumerOnlyLanes: ["src/features"],
    wrongLaneFixToAvoid: "Do not add editor-only validation while imports and generic storage can bypass it.",
    regressionProof: ["string false normalizes through generic create"],
  },
  proofRows: {
    positiveRows: ["native boolean row is preserved"],
    contradictionRows: ["string false does not activate an entry"],
    legacyDefaultRows: ["legacy string boolean row normalizes"],
  },
};

const cases = [
  ["risky missing gate blocks", riskyMissingGate, false],
  ["risky complete gate passes", completeGate, true],
  ["low-risk missing gate passes", lowRiskMissingGate, true],
  ["src-tauri missing wrong-lane blocks", srcTauriMissingWrongLane, false],
  ["cross-boundary missing detail blocks", crossBoundaryMissingDetail, false],
];

const failures = [];

function trackedScratchFiles() {
  const output = execFileSync("git", ["ls-files", "-z", "--", "scratch"], {
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean);
}

const scratchFiles = trackedScratchFiles();
if (scratchFiles.length > 0) {
  failures.push(
    [
      "scratch files must not be tracked:",
      ...scratchFiles.map((file) => `  - ${file}`),
      "Move proof artifacts to local scratch only, and keep reusable examples under tracked templates.",
    ].join("\n"),
  );
}

for (const [name, ledger, expectedReady] of cases) {
  const result = evaluateProofHealth(ledger);
  if (result.ready !== expectedReady) {
    failures.push(`${name}: expected ready=${expectedReady}, got ready=${result.ready}`);
  }
}

if (failures.length > 0) {
  console.error("Agent workflow checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Checked ${cases.length} agent workflow proof-health scenarios.`);
