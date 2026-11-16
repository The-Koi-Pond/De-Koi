// Tauri refuses to build when a JavaScript package (@tauri-apps/api, @tauri-apps/plugin-*) and its Rust crate
// (tauri, tauri-plugin-*) differ in major or minor version. Dependabot updates the two lock files separately, and
// only release builds run the Tauri CLI, so this compares the lock files on every pull request instead.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The root importer's @tauri-apps runtime packages and their resolved versions, from pnpm-lock.yaml. */
export function parsePnpmTauriPackages(lockText) {
  const rootImporter = lockText.match(/^importers:\s*\n\s+\.:\s*\n([\s\S]*?)(?=^\S|^ {2}\S)/m)?.[1] ?? "";
  const packages = {};
  const entry =
    /^\s+'?(@tauri-apps\/(?:api|plugin-[a-z0-9-]+))'?:\s*\n\s+specifier:[^\n]*\n\s+version:\s*([0-9][^\s(]*)/gm;
  for (const [, name, version] of rootImporter.matchAll(entry)) packages[name] = version;
  return packages;
}

/** Versions of the tauri and tauri-plugin-* crates, from Cargo.lock. */
export function parseCargoTauriCrates(lockText) {
  const crates = {};
  const entry = /^\[\[package\]\]\s*\nname = "(tauri|tauri-plugin-[a-z0-9-]+)"\s*\nversion = "([^"]+)"/gm;
  for (const [, name, version] of lockText.matchAll(entry)) {
    // On purpose: the newest wins when a crate appears twice, as it can during an update.
    if (!crates[name] || compareVersions(version, crates[name]) > 0) crates[name] = version;
  }
  return crates;
}

function majorMinor(version) {
  return version.split(".").slice(0, 2).join(".");
}

function compareVersions(a, b) {
  const [left, right] = [a, b].map((version) => version.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0));
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Pairs whose major.minor differ. A package without a crate (or the reverse) isn't a pair Tauri checks. */
export function findTauriVersionMismatches(npmPackages, cargoCrates) {
  const mismatches = [];
  for (const [npmName, npmVersion] of Object.entries(npmPackages)) {
    const crateName = npmName === "@tauri-apps/api" ? "tauri" : npmName.replace("@tauri-apps/plugin-", "tauri-plugin-");
    const crateVersion = cargoCrates[crateName];
    if (crateVersion && majorMinor(crateVersion) !== majorMinor(npmVersion)) {
      mismatches.push({ npmName, npmVersion, crateName, crateVersion });
    }
  }
  return mismatches;
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const npmPackages = parsePnpmTauriPackages(readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8"));
  const cargoCrates = parseCargoTauriCrates(readFileSync(resolve(repoRoot, "src-tauri/Cargo.lock"), "utf8"));
  if (!npmPackages["@tauri-apps/api"] || !cargoCrates.tauri) {
    throw new Error("Couldn't find @tauri-apps/api in pnpm-lock.yaml or tauri in src-tauri/Cargo.lock.");
  }

  const mismatches = findTauriVersionMismatches(npmPackages, cargoCrates);
  if (mismatches.length > 0) {
    for (const { npmName, npmVersion, crateName, crateVersion } of mismatches) {
      console.error(`${npmName} ${npmVersion} and ${crateName} ${crateVersion} differ in major.minor version.`);
    }
    console.error("Update the lagging side (pnpm update or cargo update -p <crate>) so each pair matches.");
    process.exit(1);
  }
  console.log(
    `Tauri versions match: ${Object.keys(npmPackages).length} JavaScript packages checked against their crates.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
