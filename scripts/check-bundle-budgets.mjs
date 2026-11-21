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
  // and summary engines left the boot shell. It grew back to 282.0 KiB, then
  // fell to 253.3 KiB once the Deki-senpai API and sidebar, the image prompt
  // compiler, and the tracker helpers behind two package indexes left it.
  // Features grew it back to 299.6 KiB; it fell to 296.4 KiB once the Tauri
  // window module loaded on first use instead of riding in vendor-tauri.
  // Main measured 296.8 KiB on 2026-11-19; it fell to 275.3 KiB once zod left
  // the home load (startup settings reads use small readers, schema checks
  // load with the write) even after merging small chunks added 5.6 KiB.
  homeJs: 300 * 1024,
  // Measured 1695.2 KiB after dropping framer-motion (#1343) and @dnd-kit
  // before it (down from 1730.4 KiB). Spend this margin on features before
  // raising it. Fanfic mode spent the last of it: main measured 1714.3 KiB and
  // the mode adds 19.3 KiB (1733.6 KiB; its lazy route chunk is 13.3 KiB), so
  // the ceiling moved from 1731 KiB to 1740 KiB. Fanfic narration, the prose
  // check, and online research then brought it to 1742.4 KiB (research's
  // planning steps and notes UI are about 5 KiB), so it moved to 1750 KiB.
  // Main measured 1531.8 KiB on 2026-10-21. Moving code out of the home load
  // costs a little here, because each new shared chunk compresses on its own:
  // the homeJs cut above measured 1540.4 KiB. Features brought main to
  // 1738.5 KiB by 2026-11-19; merging chunks under 4 KB into the chunks they
  // load with (experimentalMinChunkSize in vite.config.ts) took it to 1725.1 KiB.
  // Main measured 1737.7 KiB on 2026-11-20; Roleplay campaigns add 21.4 KiB (the builder and its prompts are about
  // 9 KiB, the runner, plan checks and prompt block about 8 KiB, the setup card, Deki card and campaign panel about
  // 4 KiB, all lazy), so it moved to 1775 KiB.
  totalJs: 1775 * 1024,
  largestLazyJs: 300 * 1024,
  css: 120 * 1024,
});

// Written by the de-koi-home-screen-chunks plugin in vite.config.ts: each source module the home screen always
// loads, and the output chunk that holds it (null when no chunk does). Looked up by module, not chunk name,
// because merged small chunks can take another module's name.
const HOME_CHUNKS_FILE = ".vite/home-chunks.json";

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
  const homeChunksRaw = files.get(HOME_CHUNKS_FILE);
  const homeChunks = homeChunksRaw ? JSON.parse(String(homeChunksRaw)) : null;
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
    if (!homeChunks) missingHomeChunks.push(HOME_CHUNKS_FILE);
    for (const [module, file] of Object.entries(homeChunks ?? {})) {
      const key = file ? Object.keys(manifest).find((candidate) => manifest[candidate].file === file) : undefined;
      if (key) visit(homeKeys, key);
      else missingHomeChunks.push(module);
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
