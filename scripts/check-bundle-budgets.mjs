import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_BUNDLE_BUDGETS = Object.freeze({
  startupJs: 700 * 1024,
  totalJs: 1700 * 1024,
  largestLazyJs: 300 * 1024,
  css: 120 * 1024,
});

function normalizedAssetPath(value) {
  return value
    .replace(/^\.?\//, "")
    .replace(/^\//, "")
    .replaceAll("\\", "/");
}

function gzipBytes(value) {
  return gzipSync(typeof value === "string" ? Buffer.from(value) : value).byteLength;
}

export function evaluateBundleBudgets(files, budgets = DEFAULT_BUNDLE_BUDGETS) {
  const html = String(files.get("index.html") ?? "");
  const manifestRaw = files.get(".vite/manifest.json");
  const manifest = manifestRaw ? JSON.parse(String(manifestRaw)) : null;
  const startupKeys = new Set();
  if (manifest) {
    const visit = (key) => {
      if (startupKeys.has(key) || !manifest[key]) return;
      startupKeys.add(key);
      for (const imported of manifest[key].imports ?? []) visit(imported);
    };
    for (const [key, chunk] of Object.entries(manifest)) {
      if (chunk.isEntry) visit(key);
    }
  }
  const startupFiles = manifest
    ? [...startupKeys]
        .map((key) => normalizedAssetPath(manifest[key].file))
        .filter((file, index, values) => file.endsWith(".js") && files.has(file) && values.indexOf(file) === index)
    : [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["']/gi)]
        .map((match) => normalizedAssetPath(match[1]))
        .filter((file, index, values) => files.has(file) && values.indexOf(file) === index);
  const jsFiles = [...files.keys()].filter((file) => file.endsWith(".js"));
  const lazyFiles = jsFiles.filter((file) => !startupFiles.includes(file));
  const cssFiles = [...files.keys()].filter((file) => file.endsWith(".css"));
  const startupJs = startupFiles.reduce((total, file) => total + gzipBytes(files.get(file)), 0);
  const totalJs = jsFiles.reduce((total, file) => total + gzipBytes(files.get(file)), 0);
  const largestLazyJs = lazyFiles.reduce((largest, file) => Math.max(largest, gzipBytes(files.get(file))), 0);
  const css = cssFiles.reduce((total, file) => total + gzipBytes(files.get(file)), 0);
  const actual = { startupJs, totalJs, largestLazyJs, css };
  const violations = Object.entries(actual)
    .filter(([category, bytes]) => bytes > budgets[category])
    .map(([category, bytes]) => ({ category, bytes, limit: budgets[category] }));
  return { ...actual, startupFiles, lazyFiles, violations };
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
  for (const category of ["startupJs", "totalJs", "largestLazyJs", "css"]) {
    console.log(`${category}: ${formatKiB(result[category])} / ${formatKiB(DEFAULT_BUNDLE_BUDGETS[category])}`);
  }
  if (result.violations.length) {
    for (const violation of result.violations) {
      console.error(`${violation.category} exceeds its budget by ${formatKiB(violation.bytes - violation.limit)}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
