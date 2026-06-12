import { evaluateProofHealth } from "../.agents/automation/scripts/proof-health.mjs";
import { ghCommand } from "../.agents/automation/scripts/gh-read.mjs";
import { classifyPrRisk } from "../.agents/automation/scripts/risk-classifier.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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
  [
    "blocking manual blocker blocks",
    { ...completeGate, manualBlockers: [{ description: "hardware check", blockingCoreClaim: true }] },
    false,
  ],
  [
    "non-blocking manual blocker passes",
    { ...completeGate, manualBlockers: [{ description: "secondary hardware check", blockingCoreClaim: false }] },
    true,
  ],
  [
    "malformed manual blocker blocks",
    { ...completeGate, manualBlockers: [{ description: "bad value", blockingCoreClaim: "false" }] },
    false,
  ],
];

const failures = [];
const scratchDir = "scratch/check-agent-workflow";

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

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function runNode(args, options = {}) {
  return execFileSync(process.execPath, args, { encoding: "utf8", ...options });
}

function expectNodeFailure(args, message) {
  try {
    runNode(args, { stdio: "pipe" });
    failures.push(message);
  } catch {
    // Expected failure.
  }
}

rmSync(scratchDir, { recursive: true, force: true });
mkdirSync(scratchDir, { recursive: true });

const quoted = ghCommand(["pr", "view", "$(touch scratch/pwned)", "O'Hara", "$VAR", "`x`"]);
expect(quoted.includes("'$(touch scratch/pwned)'"), "ghCommand must single-quote command substitution");
expect(quoted.includes("'O'\\''Hara'"), "ghCommand must escape embedded single quotes");
expect(quoted.includes("'$VAR'"), "ghCommand must single-quote shell variables");
expect(quoted.includes("'`x`'"), "ghCommand must single-quote backticks");

const importExportRisk = classifyPrRisk({
  title: "",
  body: "",
  labels: [],
  files: [
    { path: "src/tools/import-export/index.ts" },
    { path: "src/tools/chat-import.ts" },
    { path: "src/tools/exports/manifest.ts" },
  ],
});
expect(importExportRisk.categories.includes("import-export"), "import/export-like paths must classify as risky");
const portRisk = classifyPrRisk({
  title: "",
  body: "",
  labels: [],
  files: [{ path: "src/support/portal.ts" }],
});
expect(!portRisk.categories.includes("import-export"), "unrelated port substrings must not classify as import/export");

const corruptLedger = `${scratchDir}/corrupt-ledger.json`;
writeFileSync(corruptLedger, "{not-json");
expectNodeFailure(
  [".agents/automation/scripts/automation-ledger.mjs", "set", corruptLedger, "task.title=bad"],
  "automation-ledger set must fail on malformed existing JSON",
);
expect(readFileSync(corruptLedger, "utf8") === "{not-json", "malformed ledger contents must be preserved");

const missingLedger = `${scratchDir}/missing-ledger.json`;
runNode([".agents/automation/scripts/automation-ledger.mjs", "set", missingLedger, "task.type=docs"]);
expect(existsSync(missingLedger), "missing ledger should still initialize from template");

const sourceProof = `${scratchDir}/proof.txt`;
writeFileSync(sourceProof, "proof");
expectNodeFailure(
  [
    ".agents/automation/scripts/publish-evidence.mjs",
    "..",
    sourceProof,
    "--allow-committed-evidence",
  ],
  "publish-evidence must reject parent-directory slug",
);
expectNodeFailure(
  [".agents/automation/scripts/publish-evidence.mjs", "--url", "https://github.com/user-attachments/assets/example", "--ledger"],
  "publish-evidence must reject missing --ledger value",
);
const published = JSON.parse(
  runNode([
    ".agents/automation/scripts/publish-evidence.mjs",
    "issue-181",
    sourceProof,
    "--allow-committed-evidence",
  ]),
);
expect(
  published.copied?.[0] === "docs/pr-evidence/issue-181/proof.txt",
  "publish-evidence should copy only under docs/pr-evidence/<slug>/",
);
rmSync("docs/pr-evidence/issue-181", { recursive: true, force: true });

runNode(["-e", "import { chromium } from '@playwright/test'; if (!chromium?.launch) process.exit(1);"]);

const prHealthSource = readFileSync(".agents/automation/scripts/pr-health.mjs", "utf8");
expect(prHealthSource.includes("pageInfo"), "pr-health review-thread query must request pageInfo");
expect(prHealthSource.includes("while (page < 20)"), "pr-health must paginate review-thread reads");
expect(
  prHealthSource.includes('"UI evidence"') && !prHealthSource.includes('"UI evidence (if applicable)"'),
  "pr-health required headings must match the repository PR template",
);

if (failures.length > 0) {
  console.error("Agent workflow checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

rmSync(scratchDir, { recursive: true, force: true });
console.log(`Checked ${cases.length} agent workflow proof-health scenarios plus automation safety checks.`);
