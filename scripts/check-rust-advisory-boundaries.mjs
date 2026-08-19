import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADVISORY_ID = "RUSTSEC-2026-0258";
const VULNERABLE_H2_PATTERN = /^h2 v0\.3\.27(?:\s|$)/m;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function evaluateRustAdvisoryBoundaries({ waiverConfigured, profiles }) {
  for (const profile of ["desktop", "server"]) {
    if (VULNERABLE_H2_PATTERN.test(profiles[profile])) {
      throw new Error(`${profile} feature graph contains h2 0.3.27`);
    }
  }

  const devtoolsVulnerable = VULNERABLE_H2_PATTERN.test(profiles.devtools);
  if (waiverConfigured && !devtoolsVulnerable) {
    throw new Error(`remove the stale ${ADVISORY_ID} waiver`);
  }
  if (!waiverConfigured && devtoolsVulnerable) {
    throw new Error(`the devtools feature graph requires the reviewed ${ADVISORY_ID} waiver`);
  }
}

function cargoTree(features) {
  const result = spawnSync(
    "cargo",
    [
      "tree",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--edges",
      "normal",
      "--prefix",
      "none",
      "--format",
      "{p}",
      "--no-default-features",
      "--features",
      features,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`cargo tree failed for ${features}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function main() {
  const denyConfig = readFileSync(resolve(repoRoot, "deny.toml"), "utf8");
  const waiverConfigured = denyConfig.includes(`"${ADVISORY_ID}"`);
  const profiles = {
    desktop: cargoTree("desktop"),
    server: cargoTree("server"),
    devtools: cargoTree("devtools"),
  };

  evaluateRustAdvisoryBoundaries({ waiverConfigured, profiles });
  console.log(
    `Rust advisory boundary check passed: desktop/server exclude h2 0.3.27; devtools waiver ${
      waiverConfigured ? "is required" : "is absent"
    }.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
