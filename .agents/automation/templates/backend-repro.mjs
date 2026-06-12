#!/usr/bin/env node
/**
 * Scratch backend repro template.
 *
 * Copy to scratch/<issue>-backend-repro.mjs, replace the setup/action/assert
 * block, then run from the repo root. Keep repros focused on the broken code
 * path; do not start the whole app unless the route/service requires it.
 */
import assert from "node:assert/strict";

const beforeOrAfter = process.env.REPRO_PHASE ?? "after";
const recipe = process.env.REPRO_RECIPE ?? "backend-repro";

async function setup() {
  // Import the smallest module that contains the bug.
  // Example:
  // const { createThing } = await import("../packages/server/src/services/thing.js");
  return {};
}

async function exercise(_ctx) {
  // Return the observed value from the broken path.
  return {
    status: "replace-me",
  };
}

async function main() {
  const ctx = await setup();
  const observed = await exercise(ctx);

  // Replace this with the concrete expected behavior.
  assert.equal(observed.status, "expected-value");

  console.log(
    JSON.stringify(
      {
        phase: beforeOrAfter,
        recipe,
        passed: true,
        observed,
        evidence: {
          observed,
        },
        traceEvent: {
          phase: "verify",
          action: recipe,
          outcome: "passed",
          evidence: observed,
        },
        ledgerHint: "Append this output to evidence.reproduction or evidence.verification, then add a trace event.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        phase: beforeOrAfter,
        recipe,
        passed: false,
        evidence: {},
        traceEvent: {
          phase: "verify",
          action: recipe,
          outcome: "failed",
        },
        ledgerHint: "Record the failure as reproduction evidence before changing production code.",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
