import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_BUNDLE_BUDGETS = Object.freeze({
  startupJs: 700 * 1024,
  // Everything the home screen statically needs: the entry plus the lazy app
  // shell and mode surface. Measured 704.7 KiB when the home screen pulled the
  // whole chat UI and generation engine through a barrel import, 367.4 KiB
  // after (#1339), and 275.2 KiB once framer-motion was gone and the memory
  // and summary engines left the boot shell.
  homeJs: 300 * 1024,
  // Measured 1695.2 KiB after dropping framer-motion (#1343) and @dnd-kit
  // before it (down from 1730.4 KiB). Spend this margin on features before
  // raising it.
  totalJs: 1731 * 1024,
  largestLazyJs: 300 * 1024,
  css: 120 * 1024,
});

// Lazy chunks the home screen always loads, by Vite chunk name.
export const HOME_SCREEN_CHUNKS = Object.freeze(["AppExperience", "ModeSurface"]);

function normalizedAssetPath(value) {
  return value
    .replace(/^\.?\//, "")
    .replace(/^\//, "")
    .replaceAll("\\", "/");
}

function gzipBytes(value) {
  return gzipSync(typeof value === "string" ? Buffer.from(value) : value).byteLength;
}

export function evaluateBundleBudgets(files, budgets = DEFAULT_BUNDLE_BUDGETS, homeChunks = HOME_SCREEN_CHUNKS) {
  const html = String(files.get("index.html") ?? "");
  const manifestRaw = files.get(".vite/manifest.json");
  const manifest = manifestRaw ? JSON.parse(String(manifestRaw)) : null;
  const startupKeys = new Set();
  const homeKeys = new Set();
  const missingHomeChunks = [];
  if (manifest) {
    const visit = (keys, key) => {
      if (keys.has(key) || !manifest[key]) return;
      keys.add(key);
      for (const imported of manifest[key].imports ?? []) visit(keys, imported);
    };
    for (const [key, chunk] of Object.entries(manifest)) {
      if (chunk.isEntry) {
        visit(startupKeys, key);
        visit(homeKeys, key);
      }
    }
    for (const name of homeChunks) {
      const key = Object.keys(manifest).find((candidate) => manifest[candidate].name === name);
      if (key) visit(homeKeys, key);
      else missingHomeChunks.push(name);
    }
  }
  const jsFilesOf = (keys) =>
    [...keys]
      .map((key) => normalizedAssetPath(manifest[key].file))
      .filter((file, index, values) => file.endsWith(".js") && files.has(file) && values.indexOf(file) === index);
  const startupFiles = manifest
    ? jsFilesOf(startupKeys)
    : [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["']/gi)]
        .map((match) => normalizedAssetPath(match[1]))
        .filter((file, index, values) => files.has(file) && values.indexOf(file) === index);
  const homeFiles = manifest ? jsFilesOf(homeKeys) : startupFiles;
  const jsFiles = [...files.keys()].filter((file) => file.endsWith(".js"));
  const lazyFiles = jsFiles.filter((file) => !startupFiles.includes(file));
  const cssFiles = [...files.keys()].filter((file) => file.endsWith(".css"));
  const sumGzip = (list) => list.reduce((total, file) => total + gzipBytes(files.get(file)), 0);
  const startupJs = sumGzip(startupFiles);
  const homeJs = sumGzip(homeFiles);
  const totalJs = sumGzip(jsFiles);
  const largestLazyJs = lazyFiles.reduce((largest, file) => Math.max(largest, gzipBytes(files.get(file))), 0);
  const css = sumGzip(cssFiles);
  const actual = { startupJs, homeJs, totalJs, largestLazyJs, css };
  const violations = Object.entries(actual)
    .filter(([category, bytes]) => bytes > budgets[category])
    .map(([category, bytes]) => ({ category, bytes, limit: budgets[category] }));
  // A renamed home chunk would silently shrink homeJs, so a budgeted run must find all of them.
  if (budgets.homeJs !== undefined && missingHomeChunks.length) {
    violations.push({ category: "homeJs", missingChunks: missingHomeChunks });
  }
  return { ...actual, startupFiles, homeFiles, lazyFiles, violations };
}

function readDistFiles(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.set(relative(root, path).replaceAll("\\", "/"), readFileSync(path));
    }
  };
  visit(root);
  return files;
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB gzip`;
}

function main() {
  const dist = resolve(process.cwd(), "dist");
  const result = evaluateBundleBudgets(readDistFiles(dist));
  for (const category of ["startupJs", "homeJs", "totalJs", "largestLazyJs", "css"]) {
    console.log(`${category}: ${formatKiB(result[category])} / ${formatKiB(DEFAULT_BUNDLE_BUDGETS[category])}`);
  }
  if (result.violations.length) {
    for (const violation of result.violations) {
      if (violation.missingChunks) {
        console.error(`${violation.category} cannot find home chunks: ${violation.missingChunks.join(", ")}`);
      } else {
        console.error(`${violation.category} exceeds its budget by ${formatKiB(violation.bytes - violation.limit)}`);
      }
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
