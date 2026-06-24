import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(path) {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
}

function quotedCommands(source) {
  return [...source.matchAll(/"([a-zA-Z0-9_]+)"/g)].map((match) => match[1]).sort();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function parseDesktopCommands(libSource) {
  return uniqueSorted(
    libSource
      .split("storage_commands::")
      .slice(1)
      .map((rest) => rest.split("::")[1] ?? "")
      .map((rest) => rest.match(/^[a-zA-Z0-9_]+/)?.[0] ?? "")
      .filter(Boolean),
  );
}

function parseNonRemoteCommands(dispatchSource) {
  const source = dispatchSource
    .split("const NON_REMOTE_COMMANDS: &[&str] = &[")[1]
    ?.split("];", 1)[0];
  if (source === undefined) {
    throw new Error("Could not parse NON_REMOTE_COMMANDS from src-tauri/src/http_dispatch.rs");
  }
  return uniqueSorted(quotedCommands(source));
}

function parseRemoteAllowlist(remoteRuntimeSource) {
  const source = remoteRuntimeSource
    .split("const REMOTE_COMMANDS = new Set([")[1]
    ?.split("]);", 1)[0];
  if (source === undefined) {
    throw new Error("Could not parse REMOTE_COMMANDS from src/shared/api/remote-runtime.ts");
  }
  return uniqueSorted(quotedCommands(source));
}

function parseDispatchCommands(dispatchSource) {
  const source = dispatchSource
    .split("match command {")[1]
    ?.split("_ => Err", 1)[0];
  if (source === undefined) {
    throw new Error("Could not parse dispatch command match from src-tauri/src/http_dispatch.rs");
  }

  return uniqueSorted(
    source
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith('"') || !trimmed.includes("=>")) return [];
        return quotedCommands(trimmed.split("=>", 1)[0]);
      }),
  );
}

function mismatch(kind, actual, expected) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  return missing.length || extra.length ? { kind, missing, extra } : null;
}

export function findRemoteRuntimeDispatchMismatches({ libSource, dispatchSource, remoteRuntimeSource }) {
  const desktopCommands = parseDesktopCommands(libSource);
  const nonRemoteCommands = parseNonRemoteCommands(dispatchSource);
  const expectedRemoteCommands = difference(desktopCommands, nonRemoteCommands);
  const remoteAllowlist = parseRemoteAllowlist(remoteRuntimeSource);
  const dispatchCommands = parseDispatchCommands(dispatchSource);

  return [
    mismatch("remote_allowlist_mismatch", remoteAllowlist, expectedRemoteCommands),
    mismatch("http_dispatch_mismatch", dispatchCommands, remoteAllowlist),
  ].filter(Boolean);
}

function readRepoSources(root = process.cwd()) {
  return {
    libSource: readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8"),
    dispatchSource: readFileSync(resolve(root, "src-tauri/src/http_dispatch.rs"), "utf8"),
    remoteRuntimeSource: readFileSync(resolve(root, "src/shared/api/remote-runtime.ts"), "utf8"),
  };
}

function printMismatches(mismatches) {
  console.error("Remote runtime dispatch check failed:");
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch.kind}`);
    if (mismatch.missing.length > 0) console.error(`  Missing: ${mismatch.missing.join(", ")}`);
    if (mismatch.extra.length > 0) console.error(`  Extra: ${mismatch.extra.join(", ")}`);
  }
}

function isMainModule() {
  return process.argv[1] && normalizePath(fileURLToPath(import.meta.url)) === normalizePath(process.argv[1]);
}

if (isMainModule()) {
  const mismatches = findRemoteRuntimeDispatchMismatches(readRepoSources());
  if (mismatches.length > 0) {
    printMismatches(mismatches);
    process.exit(1);
  }
  console.log("Remote runtime dispatch check passed.");
}
