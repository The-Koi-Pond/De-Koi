#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { readGhJson, repoParts } from "./gh-read.mjs";
import { classifyPrRisk } from "./risk-classifier.mjs";

const DEFAULT_REPO = "The-Koi-Pond/De-Koi";
const DEFAULT_VAULT_TASKS =
  process.env.MARINARA_VAULT_TASKS ?? "D:\\Downloads\\ME-Knowledge-Base\\ME-Knowledge-Base\\05-tasks";
const ACTIVE_TASK_STATUSES = new Set(["Up Next", "In Progress", "In Review"]);
const WORKFLOW_POLICY = {
  defaultBaseBranch: "refactor",
  expectedPrTarget: "The-Koi-Pond/De-Koi:refactor",
  comparisonBase: "origin/refactor",
  teamBranchPreferred: true,
  protectedBranches: ["main", "refactor"],
};
const WORKFLOW_POLICY_SCAN_ROOTS = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  ".github/agents",
  ".github/bunny-review",
  "skills",
  ".agents/automation",
];
const STALE_BRANCH_GUIDANCE = [
  {
    pattern: new RegExp(String.raw`\bupstream/` + "stag" + String.raw`ing\b`, "i"),
    message: "stale branch guidance references the old integration branch; default De-Koi work should use origin/refactor",
  },
  {
    pattern: new RegExp(String.raw`\bPasta-Devs/Marinara-Engine:` + "stag" + String.raw`ing\b`, "i"),
    message: "stale PR target references the old Marinara staging branch; default De-Koi PRs target The-Koi-Pond/De-Koi:refactor",
  },
  {
    pattern: /\borigin\/main\b/i,
    message: "stale comparison guidance references origin/main; default De-Koi work compares against origin/refactor",
  },
  {
    pattern: /\bThe-Koi-Pond\/De-Koi:main\b/i,
    message: "stale PR target references De-Koi main; default De-Koi PRs target The-Koi-Pond/De-Koi:refactor",
  },
  {
    pattern: /\b(?:CodeRabbit\b.{0,80}\b(?:required|gate|blocking)|(?:required|gate|blocking)\b.{0,80}\bCodeRabbit)\b/i,
    message: "stale reviewer guidance treats CodeRabbit as a required gate; De-Koi uses Bunny Review unless a maintainer explicitly asks for CodeRabbit",
  },
  {
    pattern: new RegExp(
      String.raw`\bThe-Koi-Pond/De-Koi:` +
        "stag" +
        String.raw`ing\b|(?:default base(?: branch)?|PR target|target(?:ing|s)?)\s+` +
        "`?" +
        "stag" +
        String.raw`ing` +
        "`?",
      "i",
    ),
    message: "stale target guidance may imply the old integration branch; default Marinara PRs target refactor",
  },
];

function usage() {
  console.log(`Usage:
  node .agents/automation/scripts/workflow-health.mjs [options]

Options:
  --repo <owner/repo>       GitHub repository to inspect. Defaults to ${DEFAULT_REPO}
  --vault-tasks <path>      Obsidian task note directory. Defaults to MARINARA_VAULT_TASKS or ${DEFAULT_VAULT_TASKS}
  --issues                  Include open issue queue context
  --issue-limit <count>     Max open issues to inspect with --issues. Defaults to 20
  --json                    Print machine-readable JSON
  -h, --help                Show this help

This is a read-only preflight/dashboard helper. It reads GitHub pull request
state and local vault task notes, then summarizes open draft PRs, evidence
risks, linked issue state, optional open issue context, and active workflow lanes.`);
}

function parseArgs(argv) {
  const options = {
    repo: DEFAULT_REPO,
    vaultTasks: DEFAULT_VAULT_TASKS,
    issues: false,
    issueLimit: 20,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--issues") {
      options.issues = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--repo") {
      options.repo = argv[index + 1] ?? options.repo;
      index += 1;
      continue;
    }
    if (arg === "--vault-tasks") {
      options.vaultTasks = argv[index + 1] ?? options.vaultTasks;
      index += 1;
      continue;
    }
    if (arg === "--issue-limit") {
      const parsed = Number(argv[index + 1]);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --issue-limit value: ${argv[index + 1]}`);
      }
      options.issueLimit = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function ghJson(args, warnings, context) {
  return readGhJson(args, { warnings, context });
}

function checkName(check) {
  return check.context ?? check.name ?? check.workflowName ?? "unnamed check";
}

function checkRuns(statusCheckRollup) {
  const pending = [];
  const failed = [];
  const skipped = [];
  let passed = 0;
  let total = 0;

  for (const check of statusCheckRollup ?? []) {
    total += 1;
    const name = checkName(check);

    if (check.__typename === "StatusContext") {
      if (check.state === "PENDING" || check.state === "EXPECTED") pending.push(name);
      else if (["SUCCESS", "NEUTRAL"].includes(check.state)) passed += 1;
      else failed.push(`${name}: ${check.state}`);
      continue;
    }

    if (check.status && check.status !== "COMPLETED") pending.push(name);
    else if (check.conclusion === "SKIPPED") skipped.push(name);
    else if (["SUCCESS", "NEUTRAL"].includes(check.conclusion)) passed += 1;
    else failed.push(`${name}: ${check.conclusion}`);
  }

  return { total, passed, pending, failed, skipped };
}

function bunnyReviewState(statusCheckRollup) {
  const checks = (statusCheckRollup ?? []).filter((check) => /^Bunny Review$/i.test(checkName(check)));
  if (checks.length === 0) return "missing";
  if (
    checks.some(
      (check) =>
        check.state === "PENDING" ||
        check.state === "EXPECTED" ||
        (check.status && check.status !== "COMPLETED"),
    )
  ) {
    return "pending";
  }
  if (
    checks.some(
      (check) =>
        (check.state && !["SUCCESS", "NEUTRAL"].includes(check.state)) ||
        (check.conclusion && !["SUCCESS", "NEUTRAL"].includes(check.conclusion)),
    )
  ) {
    return "failed";
  }
  return "success";
}

function textMentionsLocalScratchPath(body) {
  return /(?:^|[\s(`])scratch[\\/][^\s)`]+/i.test(body ?? "");
}

function hasUiEvidenceObligation(pr) {
  const body = pr.body ?? "";
  const labels = (pr.labels ?? []).map((label) => label.name.toLowerCase());
  const files = (pr.files ?? []).map((file) => file.path);
  return (
    labels.includes("client") ||
    labels.includes("ui") ||
    /UI evidence|Visual Proof/i.test(body) ||
    files.some((path) => path.startsWith("packages/client/") || path.startsWith("docs/pr-evidence/"))
  );
}

function hasPublishedEvidence(pr) {
  const body = pr.body ?? "";
  return /https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/|gist\.github\.com\/|gist\.githubusercontent\.com\/)[^\s)]+/i.test(
    body,
  );
}

function checkedChecklistLines(body) {
  return String(body ?? "")
    .split(/\r?\n/)
    .filter((line) => /^- \[x\]/i.test(line.trim()));
}

function evidenceRisks(pr) {
  const risks = [];
  if (textMentionsLocalScratchPath(pr.body)) {
    risks.push("PR body cites local scratch evidence; publish or upload reviewer-visible evidence.");
  }
  if (hasUiEvidenceObligation(pr) && !hasPublishedEvidence(pr)) {
    risks.push("UI/runtime PR appears to lack GitHub-viewable screenshots or recordings.");
  }
  const committedEvidenceFiles = (pr.files ?? [])
    .map((file) => file.path)
    .filter((path) => path.startsWith("docs/pr-evidence/"));
  if (committedEvidenceFiles.length > 0) {
    risks.push(`PR commits temporary screenshot evidence; upload/attach proof instead: ${committedEvidenceFiles.join(", ")}`);
  }
  const checked = checkedChecklistLines(pr.body);
  if (checked.length > 0) {
    risks.push(`PR body has ${checked.length} checked checklist item(s); agent-authored PRs should leave human validation boxes unchecked.`);
  }
  return risks;
}

function proofLedgerLikelyRequired(pr) {
  return classifyPrRisk(pr);
}

function linkedIssueNumbers(body) {
  const issueNumbers = new Set();
  const closingLinePattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:[^.\n]*)/gi;
  const issueReferencePattern = /(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))?#(?<number>\d+)/g;

  for (const closingLine of String(body ?? "").matchAll(closingLinePattern)) {
    for (const issueReference of closingLine[0].matchAll(issueReferencePattern)) {
      if (issueReference.groups.owner || issueReference.groups.repo) continue;
      issueNumbers.add(Number(issueReference.groups.number));
    }
  }

  return [...issueNumbers];
}

function issueDetails(repo, numbers, warnings) {
  const { owner, name } = repoParts(repo);
  return numbers.map((number) => {
    const issue = ghJson(["api", `repos/${owner}/${name}/issues/${number}`], warnings, `issue #${number}`);
    if (!issue) return { number, available: false };

    return {
      number,
      title: issue.title,
      state: issue.state,
      url: issue.html_url,
      labels: (issue.labels ?? []).map((label) => label.name),
      available: true,
    };
  });
}

function likelyDuplicatePullRequests(repo, issueNumber, warnings) {
  const prs = ghJson(
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--search",
      String(issueNumber),
      "--limit",
      "20",
      "--json",
      "number,title,body,state,isDraft,headRefName,baseRefName,url,updatedAt",
    ],
    warnings,
    `duplicate PR search for issue #${issueNumber}`,
  );
  if (!Array.isArray(prs)) return [];

  const issuePattern = new RegExp(`(?:#${issueNumber}\\b|\\bissue[-_/# ]?${issueNumber}\\b|\\b${issueNumber}\\b)`, "i");
  return prs
    .filter((pr) => issuePattern.test(`${pr.title ?? ""}\n${pr.body ?? ""}\n${pr.headRefName ?? ""}`))
    .map((pr) => ({
      number: pr.number,
      title: pr.title ?? "",
      state: pr.state ?? "",
      isDraft: Boolean(pr.isDraft),
      headRefName: pr.headRefName ?? "",
      baseRefName: pr.baseRefName ?? "",
      url: pr.url ?? "",
      updatedAt: pr.updatedAt ?? "",
    }));
}

function issueQueue(repo, limit, warnings) {
  const issues = ghJson(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      String(limit),
      "--json",
      "number,title,labels,updatedAt,url",
    ],
    warnings,
    "open issue list",
  );
  if (!Array.isArray(issues)) return [];

  return issues.map((issue) => {
    const labels = (issue.labels ?? []).map((label) => label.name);
    const lowerLabels = labels.map((label) => label.toLowerCase());
    return {
      number: issue.number,
      title: issue.title ?? "",
      url: issue.url ?? "",
      updatedAt: issue.updatedAt ?? "",
      labels,
      fixedInStaging: lowerLabels.includes("fixed-in-staging"),
      likelyBug: lowerLabels.includes("bug"),
      likelyEnhancement: lowerLabels.includes("enhancement") || lowerLabels.includes("feature"),
      likelyDuplicatePullRequests: lowerLabels.includes("fixed-in-staging")
        ? []
        : likelyDuplicatePullRequests(repo, issue.number, warnings),
    };
  });
}

function reviewThreads(repo, number, warnings) {
  const { owner, name } = repoParts(repo);
  const query = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          isResolved
          isOutdated
        }
      }
    }
  }
}`;
  const result = ghJson(
    [
      "api",
      "graphql",
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${number}`,
      "-f",
      `query=${query}`,
    ],
    warnings,
    `review threads for PR #${number}`,
  );
  const nodes = result?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) return { available: false, total: null, unresolved: null };

  return {
    available: true,
    total: nodes.length,
    unresolved: nodes.filter((thread) => !thread.isResolved && !thread.isOutdated).length,
  };
}

function draftPullRequests(repo, warnings) {
  const listed = ghJson(
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--draft",
      "--limit",
      "100",
      "--json",
      "number",
    ],
    warnings,
    "draft PR list",
  );
  if (!Array.isArray(listed)) return [];

  return listed.map((item) => {
    const pr =
      ghJson(
        [
          "pr",
          "view",
          String(item.number),
          "--repo",
          repo,
          "--json",
          "number,title,body,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,labels,files,headRefName,baseRefName,url,updatedAt,author",
        ],
        warnings,
        `PR #${item.number}`,
      ) ?? item;

    const checks = checkRuns(pr.statusCheckRollup);
    const linkedIssues = issueDetails(repo, linkedIssueNumbers(pr.body), warnings);

    return {
      number: pr.number,
      title: pr.title ?? "",
      url: pr.url ?? "",
      author: pr.author?.login ?? "",
      baseRefName: pr.baseRefName ?? "",
      headRefName: pr.headRefName ?? "",
      updatedAt: pr.updatedAt ?? "",
      isDraft: pr.isDraft ?? true,
      mergeable: pr.mergeable ?? null,
      mergeStateStatus: pr.mergeStateStatus ?? null,
      reviewDecision: pr.reviewDecision ?? null,
      checks: {
        ...checks,
        bunnyReview: bunnyReviewState(pr.statusCheckRollup),
      },
      reviewThreads: reviewThreads(repo, pr.number, warnings),
      linkedIssues,
      evidenceRisks: evidenceRisks(pr),
      proofLedger: proofLedgerLikelyRequired(pr),
    };
  });
}

function markdownFiles(root) {
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function workflowPolicyFiles(root) {
  const files = [];
  for (const entry of WORKFLOW_POLICY_SCAN_ROOTS) {
    const fullPath = join(root, entry);
    if (!existsSync(fullPath)) continue;
    const stats = statSync(fullPath);
    if (stats.isFile()) {
      files.push(fullPath);
      continue;
    }
    const stack = [fullPath];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const child of readdirSync(current)) {
        const childPath = join(current, child);
        const childStats = statSync(childPath);
        if (childStats.isDirectory()) stack.push(childPath);
        else if (/\.(md|mjs)$/i.test(child)) files.push(childPath);
      }
    }
  }
  return files;
}

function workflowPolicyWarnings(root) {
  const warnings = [];
  for (const file of workflowPolicyFiles(root)) {
    const relativePath = relative(root, file).replaceAll("\\", "/");
    if (relativePath === ".agents/automation/scripts/workflow-health.mjs") continue;
    const body = readFileSync(file, "utf8");
    for (const rule of STALE_BRANCH_GUIDANCE) {
      if (rule.pattern.test(body)) {
        warnings.push(`${relativePath}: ${rule.message}`);
      }
    }
  }
  return warnings;
}

function frontmatterField(frontmatter, field) {
  const match = new RegExp(`^${field}:[ \\t]*([^\\r\\n]*)`, "m").exec(frontmatter);
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function activeVaultTasks(root, warnings) {
  if (!root || !existsSync(root)) {
    warnings.push(`vault task path unavailable: ${root}`);
    return [];
  }

  return markdownFiles(root)
    .map((file) => {
      const body = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
      const status = frontmatterField(frontmatter, "status");
      if (!ACTIVE_TASK_STATUSES.has(status)) return null;

      const title = frontmatterField(frontmatter, "title") || basename(file, ".md");
      return {
        title,
        status,
        path: relative(root, file),
        githubLink: frontmatterField(frontmatter, "github_link"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => `${a.status}:${a.title}`.localeCompare(`${b.status}:${b.title}`));
}

function buildReport(options) {
  const warnings = [];
  const workflowPolicy = {
    ...WORKFLOW_POLICY,
    staleGuidanceWarnings: workflowPolicyWarnings(process.cwd()),
  };
  warnings.push(...workflowPolicy.staleGuidanceWarnings);
  const pullRequests = draftPullRequests(options.repo, warnings);
  const vaultTasks = activeVaultTasks(options.vaultTasks, warnings);
  const issues = options.issues ? issueQueue(options.repo, options.issueLimit, warnings) : [];
  const activeIssues = issues.filter((issue) => !issue.fixedInStaging);
  const summary = {
    repo: options.repo,
    vaultTasksPath: options.vaultTasks,
    issuesIncluded: options.issues,
    draftPullRequestCount: pullRequests.length,
    draftPullRequestsWithPendingChecks: pullRequests.filter((pr) => pr.checks.pending.length > 0).length,
    draftPullRequestsWithFailedChecks: pullRequests.filter((pr) => pr.checks.failed.length > 0).length,
    draftPullRequestsWithEvidenceRisks: pullRequests.filter((pr) => pr.evidenceRisks.length > 0).length,
    draftPullRequestsLikelyNeedingProofLedger: pullRequests.filter((pr) => pr.proofLedger.required).length,
    openIssueCount: issues.length,
    activeOpenIssueCount: activeIssues.length,
    fixedInStagingIssueCount: issues.filter((issue) => issue.fixedInStaging).length,
    activeOpenIssuesWithLikelyDuplicatePrs: activeIssues.filter(
      (issue) => issue.likelyDuplicatePullRequests.length > 0,
    ).length,
    activeVaultTaskCount: vaultTasks.length,
    warningsCount: warnings.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    workflowPolicy,
    summary,
    pullRequests,
    issues,
    vaultTasks,
    warnings,
  };
}

function printText(report) {
  const { summary } = report;
  console.log(`Workflow health for ${summary.repo}`);
  console.log(
    `Summary: ${summary.draftPullRequestCount} draft PR(s), ${summary.draftPullRequestsWithPendingChecks} with pending checks, ${summary.draftPullRequestsWithFailedChecks} with failed checks, ${summary.draftPullRequestsWithEvidenceRisks} with evidence risks, ${summary.activeVaultTaskCount} active vault task(s).`,
  );
  console.log(
    `Policy: default base ${report.workflowPolicy.defaultBaseBranch}; PR target ${report.workflowPolicy.expectedPrTarget}; compare ${report.workflowPolicy.comparisonBase}; team branches ${report.workflowPolicy.teamBranchPreferred ? "preferred" : "not preferred"}.`,
  );
  if (summary.issuesIncluded) {
    console.log(
      `Issues: ${summary.openIssueCount} open issue(s) inspected, ${summary.activeOpenIssueCount} active after excluding fixed-in-staging, ${summary.fixedInStagingIssueCount} fixed-in-staging, ${summary.activeOpenIssuesWithLikelyDuplicatePrs} with likely duplicate PRs.`,
    );
  }

  console.log("\nDraft PRs");
  if (report.pullRequests.length === 0) {
    console.log("- None found.");
  } else {
    for (const pr of report.pullRequests) {
      const checkState =
        pr.checks.failed.length > 0
          ? `${pr.checks.failed.length} failed`
          : pr.checks.pending.length > 0
            ? `${pr.checks.pending.length} pending`
            : `${pr.checks.passed}/${pr.checks.total} passed`;
      const threadState = pr.reviewThreads.available
        ? `${pr.reviewThreads.unresolved}/${pr.reviewThreads.total} unresolved threads`
        : "review threads unavailable";
      console.log(
        `- #${pr.number} ${pr.title} (${pr.headRefName} -> ${pr.baseRefName}) ${pr.url}`,
      );
      console.log(`  checks: ${checkState}; Bunny Review: ${pr.checks.bunnyReview}; ${threadState}`);
      if (pr.linkedIssues.length > 0) {
        const issues = pr.linkedIssues
          .map((issue) =>
            issue.available
              ? `#${issue.number} ${issue.state} [${issue.labels.join(", ") || "no labels"}]`
              : `#${issue.number} unavailable`,
          )
          .join("; ");
        console.log(`  linked issues: ${issues}`);
      }
      if (pr.evidenceRisks.length > 0) {
        const evidenceLabel = pr.isDraft ? "draft evidence notes" : "evidence risks";
        console.log(`  ${evidenceLabel}: ${pr.evidenceRisks.join(" ")}`);
      }
      if (pr.proofLedger.required) {
        const proofSignals =
          pr.proofLedger.matchedFiles.length > 0 ? pr.proofLedger.matchedFiles : pr.proofLedger.categories;
        console.log(`  proof ledger likely required: ${proofSignals.join(", ")}`);
      }
    }
  }

  if (summary.issuesIncluded) {
    console.log("\nOpen Issues");
    if (report.issues.length === 0) {
      console.log("- None found.");
    } else {
      for (const issue of report.issues) {
        const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "no labels";
        const stateNote = issue.fixedInStaging ? "fixed-in-staging" : "active";
        console.log(`- #${issue.number} ${issue.title} (${stateNote}; ${labels}) ${issue.url}`);
        if (issue.likelyDuplicatePullRequests.length > 0) {
          const duplicates = issue.likelyDuplicatePullRequests
            .map((pr) => `#${pr.number} ${pr.state}${pr.isDraft ? " draft" : ""} ${pr.headRefName}`)
            .join("; ");
          console.log(`  likely duplicate PRs: ${duplicates}`);
        }
      }
    }
  }

  console.log("\nActive Vault Tasks");
  if (report.vaultTasks.length === 0) {
    console.log("- None found.");
  } else {
    for (const task of report.vaultTasks) {
      console.log(`- [${task.status}] ${task.title} (${task.path})`);
    }
  }

  if (report.warnings.length > 0) {
    console.log("\nWarnings");
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(2);
}
