import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBundleBudgets } from "./check-bundle-budgets.mjs";

test("classifies startup references separately from lazy JavaScript", () => {
  const files = new Map([
    ["index.html", '<script type="module" src="/assets/entry.js"></script><link rel="modulepreload" href="/assets/vendor.js"><link rel="stylesheet" href="/assets/app.css">'],
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

  assert.deepEqual(result.violations.map((violation) => violation.category), ["startupJs"]);
});
