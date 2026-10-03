import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBundleBudgets } from "./check-bundle-budgets.mjs";

test("classifies startup references separately from lazy JavaScript", () => {
  const files = new Map([
    [
      "index.html",
      '<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/app.css">',
    ],
    [
      ".vite/manifest.json",
      JSON.stringify({
        "src/main.ts": { file: "assets/entry.js", isEntry: true, imports: ["_vendor.js"] },
        "_vendor.js": { file: "assets/vendor.js" },
        "src/lazy.ts": { file: "assets/lazy.js", isDynamicEntry: true },
      }),
    ],
    ["assets/entry.js", "entry".repeat(100)],
    ["assets/vendor.js", "vendor".repeat(100)],
    ["assets/lazy.js", "lazy".repeat(100)],
    ["assets/app.css", "css".repeat(100)],
  ]);

  const result = evaluateBundleBudgets(files, {
    startupJs: Number.MAX_SAFE_INTEGER,
    totalJs: Number.MAX_SAFE_INTEGER,
    largestLazyJs: Number.MAX_SAFE_INTEGER,
    css: Number.MAX_SAFE_INTEGER,
  });

  assert.deepEqual(result.startupFiles.sort(), ["assets/entry.js", "assets/vendor.js"]);
  assert.deepEqual(result.lazyFiles, ["assets/lazy.js"]);
  assert.equal(result.violations.length, 0);
});

test("reports the exact budget category that is exceeded", () => {
  const files = new Map([
    ["index.html", '<script type="module" src="/assets/entry.js"></script>'],
    ["assets/entry.js", "startup payload".repeat(100)],
  ]);

  const result = evaluateBundleBudgets(files, {
    startupJs: 1,
    totalJs: Number.MAX_SAFE_INTEGER,
    largestLazyJs: Number.MAX_SAFE_INTEGER,
    css: Number.MAX_SAFE_INTEGER,
  });

  assert.deepEqual(
    result.violations.map((violation) => violation.category),
    ["startupJs"],
  );
});

test("counts the home screen's lazy chunks and their static imports in homeJs", () => {
  const files = new Map([
    ["index.html", '<script type="module" src="/assets/entry.js"></script>'],
    [
      ".vite/manifest.json",
      JSON.stringify({
        "src/main.ts": { file: "assets/entry.js", isEntry: true, dynamicImports: ["_Shell.js"] },
        "_Shell.js": { file: "assets/Shell.js", name: "Shell", isDynamicEntry: true, imports: ["_chat-ui.js"] },
        "_chat-ui.js": { file: "assets/chat-ui.js", name: "chat-ui" },
        "src/game.ts": { file: "assets/game.js", name: "game", isDynamicEntry: true },
      }),
    ],
    ["assets/entry.js", "entry".repeat(100)],
    ["assets/Shell.js", "shell".repeat(100)],
    ["assets/chat-ui.js", "chat".repeat(100)],
    ["assets/game.js", "game".repeat(100)],
  ]);

  const result = evaluateBundleBudgets(files, { homeJs: 1 }, ["Shell"]);

  assert.deepEqual(result.homeFiles.sort(), ["assets/Shell.js", "assets/chat-ui.js", "assets/entry.js"]);
  assert.ok(result.homeJs > result.startupJs);
  assert.deepEqual(
    result.violations.map((violation) => violation.category),
    ["homeJs"],
  );
});

test("fails homeJs when a named home chunk is missing from the manifest", () => {
  const files = new Map([
    ["index.html", '<script type="module" src="/assets/entry.js"></script>'],
    [".vite/manifest.json", JSON.stringify({ "src/main.ts": { file: "assets/entry.js", isEntry: true } })],
    ["assets/entry.js", "entry".repeat(100)],
  ]);

  const result = evaluateBundleBudgets(files, { homeJs: Number.MAX_SAFE_INTEGER }, ["AppExperience"]);

  assert.deepEqual(result.violations, [{ category: "homeJs", missingChunks: ["AppExperience"] }]);
});
