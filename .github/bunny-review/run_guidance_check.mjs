import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const checkScript = resolve(scriptDir, "check_guidance_digest.py");
const candidates =
  process.platform === "win32"
    ? [
        ["python", checkScript],
        ["py", "-3", checkScript],
        ["python3", checkScript],
      ]
    : [
        ["python3", checkScript],
        ["python", checkScript],
      ];

const failures = [];
for (const [command, ...args] of candidates) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status === 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(0);
  }
  failures.push({
    command: [command, ...args].join(" "),
    error: result.error ? result.error.message : "",
    status: result.status,
    stderr: result.stderr || "",
  });
}

console.error("Unable to run Bunny guidance digest proof with any Python launcher.");
for (const failure of failures) {
  console.error(`- ${failure.command}: status=${failure.status ?? "spawn-error"}`);
  if (failure.error) {
    console.error(`  error: ${failure.error}`);
  }
  if (failure.stderr.trim()) {
    console.error(`  stderr: ${failure.stderr.trim()}`);
  }
}
process.exit(1);
