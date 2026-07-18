import { readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/ci-full.yml", "utf8");
const ruleset = JSON.parse(await readFile(".github/rulesets/protect-main.json", "utf8"));

function requireText(condition, message) {
  if (!condition) throw new Error(message);
}

for (const trigger of ["pull_request:", "schedule:", "workflow_dispatch:"]) {
  requireText(workflow.includes(trigger), `CI Full must retain the ${trigger.slice(0, -1)} trigger.`);
}

requireText(
  workflow.includes("run: pnpm check:deterministic"),
  "CI Full must run the repository's deterministic gate source of truth.",
);
requireText(
  /required:\s*\n\s+name: Required Validation[\s\S]*?\n\s+needs:\s*\n\s+- classify\s*\n\s+- frontend\s*\n\s+- rust\s*\n\s+- smoke/.test(
    workflow,
  ),
  "CI Full must publish Required Validation after every applicable lane.",
);

const denyStepStart = workflow.indexOf("- name: Rust dependency policy");
const denyStepEnd = workflow.indexOf("\n      - name:", denyStepStart + 1);
const denyStep = denyStepStart >= 0 ? workflow.slice(denyStepStart, denyStepEnd >= 0 ? denyStepEnd : undefined) : "";
requireText(Boolean(denyStep), "CI Full must run cargo deny as Rust dependency policy.");
requireText(denyStep.includes("run: cargo deny"), "Rust dependency policy must invoke cargo deny.");
requireText(
  denyStep.includes("cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml check"),
  "Rust dependency policy must pass global cargo-deny options before the check subcommand.",
);
requireText(!denyStep.includes("continue-on-error"), "Rust dependency policy must remain blocking.");

const ruleTypes = new Set(ruleset.rules.map((rule) => rule.type));
for (const type of ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]) {
  requireText(ruleTypes.has(type), `Protect main ruleset is missing ${type}.`);
}
const statusRule = ruleset.rules.find((rule) => rule.type === "required_status_checks");
requireText(
  statusRule.parameters.strict_required_status_checks_policy === true,
  "Protect main must require the branch to be current before merge.",
);
requireText(
  statusRule.parameters.required_status_checks.some((check) => check.context === "Required Validation"),
  "Protect main must require the Required Validation aggregate check.",
);
requireText(ruleset.bypass_actors.length === 0, "Protect main must not declare direct-push bypass actors.");

console.log("Main protection workflow and ruleset contract passed.");
