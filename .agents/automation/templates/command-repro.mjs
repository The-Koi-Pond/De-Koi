#!/usr/bin/env node
/**
 * Scratch command/build repro template.
 *
 * Copy to scratch/<issue>-command-repro.mjs and replace COMMAND/ARGS with the
 * exact failing command. Use this for build/config bugs where the command
 * output is the bug proof.
 */
import { spawnSync } from "node:child_process";

const COMMAND = "pnpm";
const ARGS = ["check"];
const EXPECTED_EXIT_CODE = 0;
const PHASE = process.env.REPRO_PHASE ?? "after";
const RECIPE = process.env.REPRO_RECIPE ?? "command-repro";

const result = spawnSync(COMMAND, ARGS, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

const summary = {
  phase: PHASE,
  recipe: RECIPE,
  passed: result.status === EXPECTED_EXIT_CODE,
  command: [COMMAND, ...ARGS].join(" "),
  exitCode: result.status,
  expectedExitCode: EXPECTED_EXIT_CODE,
  evidence: {
    command: [COMMAND, ...ARGS].join(" "),
    exitCode: result.status,
  },
  traceEvent: {
    phase: "verify",
    action: [COMMAND, ...ARGS].join(" "),
    outcome: result.status === EXPECTED_EXIT_CODE ? "passed" : "failed",
    evidence: `exitCode=${result.status}`,
  },
  ledgerHint: "Append this output to evidence.commands and add the traceEvent to trace.",
  stdoutTail: result.stdout?.split(/\r?\n/).slice(-40).join("\n") ?? "",
  stderrTail: result.stderr?.split(/\r?\n/).slice(-40).join("\n") ?? "",
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.passed ? 0 : 1);
