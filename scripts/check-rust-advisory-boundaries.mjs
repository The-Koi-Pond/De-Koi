import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Advisories waived in deny.toml because the vulnerable crate is reachable
 * only through the opt-in devtools feature. Each must stay out of every
 * production graph, and its waiver must go once devtools no longer needs it.
 */
export const DEVTOOLS_ONLY_ADVISORIES = [
  { id: "RUSTSEC-2026-0258", crate: "h2 0.3.27", pattern: /^h2 v0\.3\.27(?:\s|$)/m },
  {
    id: "RUSTSEC-2026-0293",
    crate: "ringbuf < 0.5.2",
    pattern: /^ringbuf v(?:0\.[0-4]\.\d+|0\.5\.[01])(?:\s|$)/m,
  },
];
export const RUST_ADVISORY_PROFILES = {
  desktop: { features: "desktop" },
  server: { features: "server" },
  // Pi build commands are kept on this feature by check-pi-container-distribution.mjs.
  pi: { features: "server", target: "aarch64-unknown-linux-gnu" },
};
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function evaluateRustAdvisoryBoundaries({ waivedAdvisories, profiles }) {
  const waived = new Set(waivedAdvisories);
  for (const advisory of DEVTOOLS_ONLY_ADVISORIES) {
    for (const profile of Object.keys(RUST_ADVISORY_PROFILES)) {
      if (advisory.pattern.test(profiles[profile])) {
        throw new Error(`${profile} feature graph contains ${advisory.crate} (${advisory.id})`);
      }
    }
    const devtoolsVulnerable = advisory.pattern.test(profiles.devtools);
    if (waived.has(advisory.id) && !devtoolsVulnerable) {
      throw new Error(`remove the stale ${advisory.id} waiver`);
    }
    if (!waived.has(advisory.id) && devtoolsVulnerable) {
      throw new Error(`the devtools feature graph requires the reviewed ${advisory.id} waiver`);
    }
  }
}

/** Advisory ids in deny.toml's active `[advisories] ignore = [...]` list; comments do not count. */
export function parseWaivedAdvisories(denyConfig) {
  const withoutComments = denyConfig
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
  const section = withoutComments.match(/^\[advisories\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$|(?![\s\S]))/m)?.[1] ?? "";
  const list = section.match(/^\s*ignore\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "";
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
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
  const waivedAdvisories = parseWaivedAdvisories(denyConfig);
  const profiles = Object.fromEntries(
    Object.entries(RUST_ADVISORY_PROFILES).map(([profile, config]) => [profile, cargoTree(config)]),
  );
  profiles.devtools = cargoTree({ features: "devtools" });

  evaluateRustAdvisoryBoundaries({ waivedAdvisories, profiles });
  console.log(
    `Rust advisory boundary check passed: desktop/server/Pi ARM64 Linux exclude ${DEVTOOLS_ONLY_ADVISORIES.map(
      (advisory) => advisory.crate,
    ).join(" and ")}; devtools waivers: ${waivedAdvisories.join(", ") || "none"}.`,
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
