import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADVISORY_ID = "RUSTSEC-2026-0258";
const VULNERABLE_H2_PATTERN = /^h2 v0\.3\.27(?:\s|$)/m;
export const RUST_ADVISORY_PROFILES = {
  desktop: { features: "desktop" },
  server: { features: "server" },
  // Pi build commands are kept on this feature by check-pi-container-distribution.mjs.
  pi: { features: "server", target: "aarch64-unknown-linux-gnu" },
};
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function evaluateRustAdvisoryBoundaries({ waiverConfigured, profiles }) {
  for (const profile of Object.keys(RUST_ADVISORY_PROFILES)) {
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

function cargoTree({ features, target }) {
  const targetArgs = target ? ["--target", target] : [];
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
      ...targetArgs,
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
  const profiles = Object.fromEntries(
    Object.entries(RUST_ADVISORY_PROFILES).map(([profile, config]) => [profile, cargoTree(config)]),
  );
  profiles.devtools = cargoTree({ features: "devtools" });

  evaluateRustAdvisoryBoundaries({ waiverConfigured, profiles });
  console.log(
    `Rust advisory boundary check passed: desktop/server/Pi ARM64 Linux exclude h2 0.3.27; devtools waiver ${
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
