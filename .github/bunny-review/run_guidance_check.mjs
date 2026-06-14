import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const checkScript = resolve(scriptDir, "check_guidance_digest.py");

function candidateCommands() {
  return process.platform === "win32"
    ? [
        ["python", checkScript],
        ["py", "-3", checkScript],
        ["python3", checkScript],
      ]
    : [
        ["python3", checkScript],
        ["python", checkScript],
      ];
}

function commandLabel(candidate) {
  return candidate.join(" ");
}

function isMissingLauncher(result) {
  return result.error?.code === "ENOENT";
}

function runCandidates(candidates, spawn = spawnSync, io = process) {
  const missing = [];
  for (const [command, ...args] of candidates) {
    const result = spawn(command, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    if (isMissingLauncher(result)) {
      missing.push(commandLabel([command, ...args]));
      continue;
    }
    if (result.error) {
      io.stderr.write(`Unable to run ${command}: ${result.error.message}\n`);
      return 1;
    }
    io.stdout.write(result.stdout || "");
    io.stderr.write(result.stderr || "");
    return result.status ?? 1;
  }

  io.stderr.write("Unable to run Bunny review smoke proof with any Python launcher.\n");
  for (const command of missing) {
    io.stderr.write(`- ${command}: launcher not found\n`);
  }
  return 1;
}

function runSelfTest() {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  };

  let code = runCandidates(
    [
      ["missing-python", checkScript],
      ["working-python", checkScript],
    ],
    (command) => {
      calls += 1;
      if (command === "missing-python") {
        const error = new Error("spawn missing-python ENOENT");
        error.code = "ENOENT";
        return { error, status: null, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "digest proof ok\n", stderr: "" };
    },
    io,
  );
  assert.equal(code, 0);
  assert.equal(calls, 2);
  assert.match(stdout, /digest proof ok/);

  calls = 0;
  stdout = "";
  stderr = "";
  code = runCandidates(
    [
      ["failing-python", checkScript],
      ["working-python", checkScript],
    ],
    (command) => {
      calls += 1;
      if (command === "failing-python") {
        return { status: 1, stdout: "", stderr: "digest proof failed\n" };
      }
      return { status: 0, stdout: "should not run\n", stderr: "" };
    },
    io,
  );
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.match(stderr, /digest proof failed/);
  assert.doesNotMatch(stdout, /should not run/);

  console.log("launcher_self_test missing_fallback=true proof_failure_forwarded=true");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  process.exit(runCandidates(candidateCommands()));
}
