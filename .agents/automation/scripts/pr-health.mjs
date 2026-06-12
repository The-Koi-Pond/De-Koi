#!/usr/bin/env node
import { ghCommand, readGhJson, readJsonFile, repoParts } from "./gh-read.mjs";
import { evaluateProofHealth } from "./proof-health.mjs";
import { classifyPrRisk, hasReviewerDispositions } from "./risk-classifier.mjs";

const DEFAULT_REPO = "The-Koi-Pond/De-Koi";
const PR_JSON_FIELDS =
  "number,title,body,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,labels,files,headRefName,baseRefName,url";
const REQUIRED_TEMPLATE_HEADINGS = [
  "Linked issue",
  "Why this change",
  "What changed",
  "Validation",
  "Docs and release impact",
  "UI evidence",
];

function usage() {
  console.log(`Usage:
  node .agents/automation/scripts/pr-health.mjs <pr-number> [owner/repo] [options]

Options:
  --repo <owner/repo>       GitHub repository to inspect. Defaults to ${DEFAULT_REPO}
  --pr-json <path>          Read PR JSON captured from gh pr view instead of spawning gh
  --threads-json <path>     Read review-thread JSON captured from gh api graphql instead of spawning gh
  --ledger <path>           Include claim-proof quality from a scratch automation ledger
  --for-ready               Treat draft-only evidence gaps as blockers for mark-ready checks
  --json                    Accepted for consistency; output is always JSON
  -h, --help                Show this help

Checks mergeability, CI, Bunny Review, unresolved review threads, focused PR text,
template shape, and evidence-link hygiene for one pull request.`);
}

function parseArgs(argv) {
  const options = {
    prNumber: null,
    repo: DEFAULT_REPO,
    prJson: null,
    threadsJson: null,
    ledger: null,
    forReady: false,
    help: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") continue;
    if (arg === "--for-ready") {
      options.forReady = true;
      continue;
    }
    if (arg === "--repo") {
      options.repo = argv[index + 1] ?? options.repo;
      index += 1;
      continue;
    }
    if (arg === "--pr-json") {
      options.prJson = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--threads-json") {
      options.threadsJson = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--ledger") {
      options.ledger = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    positional.push(arg);
  }

  options.prNumber = positional[0] ?? null;
  if (positional[1]) options.repo = positional[1];
  return options;
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function noteDraft(message) {
  draftNotes.push(message);
}

function printAndExit(output, exitCode) {
  console.log(JSON.stringify(output, null, 2));
  process.exit(exitCode);
}

function checkName(check) {
  return check.context ?? check.name ?? check.workflowName ?? "unnamed check";
}

function checkRuns(statusCheckRollup) {
  const pending = [];
  const failed = [];
  const skipped = [];

  for (const check of statusCheckRollup ?? []) {
    const name = checkName(check);
    if (check.__typename === "StatusContext") {
      if (check.state === "PENDING" || check.state === "EXPECTED") pending.push(name);
      else if (!["SUCCESS", "NEUTRAL"].includes(check.state)) failed.push(`${name}: ${check.state}`);
      continue;
    }

    if (check.status && check.status !== "COMPLETED") pending.push(name);
    else if (check.conclusion === "SKIPPED") skipped.push(name);
    else if (!["SUCCESS", "NEUTRAL"].includes(check.conclusion)) failed.push(`${name}: ${check.conclusion}`);
  }

  return { pending, failed, skipped };
}

function checkSucceeded(statusCheckRollup, pattern) {
  return (statusCheckRollup ?? []).some((check) => {
    const name = checkName(check);
    if (!pattern.test(name)) return false;
    if (check.__typename === "StatusContext") return ["SUCCESS", "NEUTRAL"].includes(check.state);
    return ["SUCCESS", "NEUTRAL"].includes(check.conclusion);
  });
}

function hasBunnyReviewSuccess(statusCheckRollup) {
  return (statusCheckRollup ?? []).some(
    (check) =>
      /^Bunny Review$/i.test(checkName(check)) &&
      ((check.__typename === "StatusContext" && check.state === "SUCCESS") ||
        (check.conclusion && ["SUCCESS", "NEUTRAL"].includes(check.conclusion))),
  );
}

function localScratchPaths(body) {
  return [...String(body ?? "").matchAll(/(?:^|[\s(`])(?<path>scratch[\\/][^\s)`]+)/gi)].map(
    (match) => match.groups.path,
  );
}

function publishedEvidence(pr) {
  const body = pr.body ?? "";
  const files = (pr.files ?? []).map((file) => file.path).filter((path) => path.startsWith("docs/pr-evidence/"));
  const links = [
    ...body.matchAll(
      /https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/|gist\.github\.com\/|gist\.githubusercontent\.com\/)[^\s)]+/gi,
    ),
  ]
    .map((match) => match[0])
    .filter((link) => /github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com|gist\./i.test(link));
  return { files, links, present: links.length > 0 };
}

function hasUiEvidenceObligation(pr) {
  const body = pr.body ?? "";
  const labels = (pr.labels ?? []).map((label) => label.name.toLowerCase());
  const files = (pr.files ?? []).map((file) => file.path);
  return (
    labels.includes("client") ||
    labels.includes("ui") ||
    files.some((path) => path.startsWith("packages/client/") || path.startsWith("docs/pr-evidence/"))
  );
}

function manualOnlyBoundaries(body) {
  return String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--") && !line.startsWith("#") && !/^- \[[ x]\]/i.test(line))
    .filter((line) =>
      /\b(manual|manually|cannot|could not|not verified|Android device|real Android|device verification|manual note)\b/i.test(
        line,
      ),
    )
    .slice(0, 10);
}

function hasChecked(body, labelPattern) {
  const linePattern = new RegExp(`^- \\[x\\] .*${labelPattern}`, "gim");
  return linePattern.test(body);
}

function missingTemplateHeadings(body) {
  return REQUIRED_TEMPLATE_HEADINGS.filter((heading) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`^##\\s+${escaped}\\s*$`, "im").test(body ?? "");
  });
}

function reviewDecisionState(value) {
  const state = value || "";
  return {
    state,
    blocksReady: state === "CHANGES_REQUESTED",
  };
}

function threadQuery() {
  return `
query($owner:String!, $name:String!, $number:Int!, $after:String) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100, after:$after) {
        nodes {
          isResolved
          isOutdated
          isCollapsed
          path
          line
          comments(first:10) {
            nodes {
              author { login }
              bodyText
              url
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;
}

function threadArgs(owner, name, number, after = null) {
  const args = [
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${number}`,
  ];
  if (after) args.push("-f", `after=${after}`);
  args.push("-f", `query=${threadQuery()}`);
  return args;
}

function threadConnection(result) {
  return result?.data?.repository?.pullRequest?.reviewThreads ?? null;
}

function looksLikeThreadNode(value) {
  return value && typeof value === "object" && ("isResolved" in value || "isOutdated" in value);
}

function reviewThreadNodes(result) {
  if (Array.isArray(result)) {
    if (result.every(looksLikeThreadNode)) return result;
    const connections = result.map(threadConnection);
    if (connections.every((connection) => connection && Array.isArray(connection.nodes))) {
      return connections.flatMap((connection) => connection.nodes);
    }
    return result.length === 0 ? [] : null;
  }
  return threadConnection(result)?.nodes ?? null;
}

function offlineThreadsComplete(result) {
  if (result?._paginationComplete === true || result?.paginationComplete === true) return true;
  if (Array.isArray(result)) {
    if (result.every(looksLikeThreadNode)) return true;
    const connections = result.map(threadConnection);
    if (connections.some((connection) => !connection || !Array.isArray(connection.nodes))) return false;
    if (connections.length === 0) return true;
    return connections[connections.length - 1]?.pageInfo?.hasNextPage === false;
  }
  const pageInfo = threadConnection(result)?.pageInfo;
  return pageInfo ? pageInfo.hasNextPage === false : false;
}

const warnings = [];
const failures = [];
const draftNotes = [];
const fallbackCommands = [];

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(2);
}

if (options.help) {
  usage();
  process.exit(0);
}

if (!options.prNumber) {
  usage();
  process.exit(2);
}

const { owner, name } = repoParts(options.repo);
const prArgs = [
  "pr",
  "view",
  options.prNumber,
  "--repo",
  options.repo,
  "--json",
  PR_JSON_FIELDS,
];
const offlineCaptureCommands = [
  `${ghCommand(prArgs)} | Out-File -Encoding utf8 scratch/pr-health-${options.prNumber}-pr.json`,
  `${ghCommand(threadArgs(owner, name, options.prNumber))} | Out-File -Encoding utf8 scratch/pr-health-${options.prNumber}-threads.json`,
];

const pr = options.prJson
  ? readJsonFile(options.prJson, {
      warnings,
      failures,
      context: `PR #${options.prNumber}`,
      required: true,
    })
  : readGhJson(prArgs, {
      warnings,
      failures,
      fallbackCommands,
      context: `PR #${options.prNumber}`,
      required: true,
    });

if (!pr) {
  printAndExit(
    {
      pr: {
        number: Number(options.prNumber),
        repo: options.repo,
        available: false,
      },
      mode: { forReady: options.forReady },
      checks: {
        failed: [],
        pending: [],
        skipped: [],
        bunnyReviewSuccess: false,
        available: false,
      },
      reviewThreads: {
        available: false,
        unresolved: null,
        total: null,
      },
      template: { missingHeadings: REQUIRED_TEMPLATE_HEADINGS },
      evidence: {
        uiEvidenceRequired: false,
        localOnlyEvidence: [],
        publishedEvidence: { files: [], links: [], present: false },
        manualOnlyBoundaries: [],
      },
      draftNotes,
      warnings,
      failures,
      readyBlockers: failures,
      fallbackCommands,
      offlineCaptureCommands,
      ready: false,
    },
    1,
  );
}

let threadResult = null;
if (options.threadsJson) {
  threadResult = readJsonFile(options.threadsJson, {
    warnings,
    context: `review threads for PR #${options.prNumber}`,
    required: false,
  });
  if (threadResult && !offlineThreadsComplete(threadResult)) {
    fail("offline review-thread JSON does not prove pagination is complete");
  }
} else {
  const allNodes = [];
  let after = null;
  let page = 0;
  while (page < 20) {
    const pageResult = readGhJson(threadArgs(owner, name, options.prNumber, after), {
      warnings,
      fallbackCommands,
      context: `review threads for PR #${options.prNumber}`,
      required: page === 0,
    });
    if (!pageResult) break;
    const connection = threadConnection(pageResult);
    if (!connection || !Array.isArray(connection.nodes)) break;
    allNodes.push(...connection.nodes);
    page += 1;
    if (!connection.pageInfo?.hasNextPage) {
      threadResult = allNodes;
      break;
    }
    after = connection.pageInfo.endCursor;
    if (!after) {
      fail("review thread pagination reported another page without an endCursor");
      break;
    }
  }
  if (!threadResult && allNodes.length > 0) {
    fail("review thread pagination did not complete within the safety limit");
    threadResult = allNodes;
  }
}
const reviewThreads = reviewThreadNodes(threadResult);
if (!reviewThreads) {
  fail("review thread state unavailable; cannot prove there are no unresolved inline comments");
}
const unresolvedThreads = reviewThreads
  ? reviewThreads.filter((thread) => !thread.isResolved && !thread.isOutdated)
  : [];

if (pr.state !== "OPEN") fail(`PR state is ${pr.state}; health gate only applies to open PRs`);
if (pr.isDraft) noteDraft("PR is draft; this is an intentional human-readiness gate.");
if (pr.state === "OPEN" && (pr.mergeable !== "MERGEABLE" || pr.mergeStateStatus !== "CLEAN")) {
  fail(`mergeability is ${pr.mergeable}/${pr.mergeStateStatus}`);
}

const checks = checkRuns(pr.statusCheckRollup);
for (const check of checks.failed) fail(`check failed: ${check}`);
for (const check of checks.pending) fail(`check pending: ${check}`);
if (!hasBunnyReviewSuccess(pr.statusCheckRollup)) fail("Bunny Review status is not SUCCESS");

if (unresolvedThreads.length > 0) {
  for (const thread of unresolvedThreads) {
    const firstComment = thread.comments.nodes[0];
    fail(
      `unresolved review thread: ${thread.path}${thread.line ? `:${thread.line}` : ""} ${firstComment?.url ?? ""}`.trim(),
    );
  }
}

const body = pr.body ?? "";
const template = { missingHeadings: missingTemplateHeadings(body) };
if (template.missingHeadings.length > 0) {
  fail(`PR body is missing template heading(s): ${template.missingHeadings.join(", ")}`);
}

if (
  hasChecked(body, "Matching validation|pnpm check") &&
  !/(matching validation|pnpm check|pnpm typecheck|pnpm build|pnpm check:|cargo check)[\s\S]{0,500}(passed|pass|success|successful)/i.test(body) &&
  !checkSucceeded(pr.statusCheckRollup, /pnpm-validate|pnpm check|typecheck|build|architecture|docs|agent-workflow|cargo check/i)
) {
  fail("matching validation checkbox is checked without matching pass evidence in the PR body");
}
if (
  hasChecked(body, "Container|Docker|Podman") &&
  !/(container-build-test|docker|podman)[\s\S]{0,500}(passed|pass|success|successful)/i.test(body) &&
  !checkSucceeded(pr.statusCheckRollup, /container-build-test|docker|podman/i)
) {
  fail("container checkbox is checked without matching container/Docker/Podman pass evidence in the PR body");
}
if (hasChecked(body, "Ran the app|clicked through") && !/(Playwright|browser|clicked|click-through|manual)[\s\S]{0,700}(passed|pass|verified|screenshot|evidence)/i.test(body)) {
  fail("app click-through checkbox is checked without matching browser/manual proof in the PR body");
}
if (hasChecked(body, "edge cases") && !/(edge case|light|dark|mobile|empty state|error path)[\s\S]{0,700}(passed|pass|verified|tested)/i.test(body)) {
  fail("edge-case checkbox is checked without matching edge-case proof in the PR body");
}
if (hasChecked(body, "manual verification completed") && !/(manual verification|machine verification|Codex verification|Playwright|scratch|evidence)[\s\S]{0,700}(passed|complete|completed|verified|no manual-only blocker)/i.test(body)) {
  fail("manual verification checkbox is checked without matching verification completion proof in the PR body");
}
if (hasChecked(body, "CONTRIBUTING") && !/(CONTRIBUTING|AGENTS\.md)[\s\S]{0,500}(read|followed|checked|reviewed)/i.test(body)) {
  fail("CONTRIBUTING checkbox is checked without matching rule-read evidence in the PR body");
}
if (hasChecked(body, "No docs changes needed") && !/(No docs|docs? changes?)[\s\S]{0,500}(needed|not needed|not applicable|N\/A)/i.test(body)) {
  fail("no-docs checkbox is checked without matching docs impact note in the PR body");
}
if (hasChecked(body, "Updated docs") && !/(README|CONTRIBUTING|CHANGELOG|docs\/|android\/README)[\s\S]{0,700}(updated|changed|documented)/i.test(body)) {
  fail("updated-docs checkbox is checked without matching docs update evidence in the PR body");
}
if (hasChecked(body, "Version|release files") && !/(version|release)[\s\S]{0,700}(updated|bumped|sync|check|not applicable|N\/A)/i.test(body)) {
  fail("version/release checkbox is checked without matching version/release evidence in the PR body");
}

if (!/pnpm check|pnpm-validate|baseline|matching validation|pnpm typecheck|pnpm build|pnpm check:|cargo check/i.test(body)) {
  warn("PR body does not mention matching validation or CI evidence.");
}

const evidence = {
  uiEvidenceRequired: hasUiEvidenceObligation(pr),
  localOnlyEvidence: localScratchPaths(body),
  publishedEvidence: publishedEvidence(pr),
  manualOnlyBoundaries: manualOnlyBoundaries(body),
};

const risk = classifyPrRisk(pr);
let proofHealth = null;
if (options.ledger) {
  const ledger = readJsonFile(options.ledger, {
    warnings,
    failures,
    context: `proof ledger ${options.ledger}`,
    required: true,
  });
  if (ledger) {
    proofHealth = evaluateProofHealth(ledger);
    if (!proofHealth.ready) {
      for (const failure of proofHealth.failures) fail(`proofHealth: ${failure}`);
    }
    for (const warning of proofHealth.warnings) warn(`proofHealth: ${warning}`);
  }
} else if (risk.required) {
  proofHealth = {
    required: true,
    status: "missing",
    ready: false,
    riskRequired: true,
    risk,
    warnings: [],
    failures: ["proofHealth ledger required for risky PR; rerun with --ledger <path>"],
  };
  fail("proofHealth ledger required for risky PR; rerun with --ledger <path>");
}

if (risk.required && options.ledger && proofHealth && proofHealth.ready && proofHealth.riskRequired === false) {
  fail("proofHealth ledger does not mark this risky PR as riskRequired; add claimBoundary/risk details to the ledger");
}

const reviewDecision = reviewDecisionState(pr.reviewDecision);
if (reviewDecision.blocksReady) {
  if (!options.ledger) {
    fail("reviewDecision is CHANGES_REQUESTED; rerun with --ledger <path> containing reviewer dispositions");
  } else if (!proofHealth?.ready) {
    fail("reviewDecision is CHANGES_REQUESTED and proofHealth is not clean");
  } else if (!hasReviewerDispositions(proofHealth)) {
    fail("reviewDecision is CHANGES_REQUESTED; reviewThreadLedger dispositions are required");
  } else if (unresolvedThreads.length > 0) {
    fail("reviewDecision is CHANGES_REQUESTED and unresolved active review threads remain");
  } else {
    warn("reviewDecision is still CHANGES_REQUESTED, but active threads are clear and ledger dispositions exist");
  }
}

if (evidence.localOnlyEvidence.length > 0) {
  warn("PR body references local scratch paths; reviewer-visible evidence should use GitHub-viewable links when cited as proof.");
}

if (evidence.publishedEvidence.files.length > 0) {
  fail(`Temporary PR evidence should be uploaded/attached instead of committed: ${evidence.publishedEvidence.files.join(", ")}`);
}

if (evidence.uiEvidenceRequired && !evidence.publishedEvidence.present) {
  const message = "UI/runtime PR lacks uploaded GitHub/gist screenshot or recording evidence";
  if (pr.isDraft && !options.forReady) noteDraft(`${message}; needed before ready-for-review.`);
  else fail(message);
}

const ready = failures.length === 0 && (!pr.isDraft || options.forReady);
const output = {
  pr: {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    isDraft: pr.isDraft,
  },
  mode: {
    forReady: options.forReady,
    offline: Boolean(options.prJson || options.threadsJson),
  },
  checks: {
    failed: checks.failed,
    pending: checks.pending,
    skipped: checks.skipped,
    bunnyReviewSuccess: hasBunnyReviewSuccess(pr.statusCheckRollup),
  },
  reviewThreads: {
    available: Boolean(reviewThreads),
    unresolved: reviewThreads ? unresolvedThreads.length : null,
    total: reviewThreads ? reviewThreads.length : null,
  },
  reviewDecision,
  risk,
  template,
  evidence,
  proofHealth,
  draftNotes,
  warnings,
  failures,
  readyBlockers: failures,
  fallbackCommands,
  offlineCaptureCommands,
  ready,
};

console.log(JSON.stringify(output, null, 2));

if (failures.length > 0) process.exit(1);
