import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require("../lighthouserc.cjs");

test("performance Lighthouse checks use stable sampling and block regressions", () => {
  assert.equal(config.ci.collect.numberOfRuns, 3);
  for (const assertion of [
    "categories:performance",
    "resource-summary:script:size",
    "resource-summary:stylesheet:size",
  ]) {
    assert.equal(config.ci.assert.assertions[assertion][0], "error");
  }
});
