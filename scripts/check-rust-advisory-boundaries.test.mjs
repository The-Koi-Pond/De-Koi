import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRustAdvisoryBoundaries } from "./check-rust-advisory-boundaries.mjs";

const patchedGraph = "de-koi v1.6.1\nh2 v0.4.16";
const vulnerableGraph = "de-koi v1.6.1\nh2 v0.3.27\ntauri-plugin-devtools v2.1.0";

test("accepts the temporary waiver only when h2 0.3 is devtools-only", () => {
  assert.doesNotThrow(() =>
    evaluateRustAdvisoryBoundaries({
      waiverConfigured: true,
      profiles: {
        desktop: patchedGraph,
        server: patchedGraph,
        pi: patchedGraph,
        devtools: vulnerableGraph,
      },
    }),
  );
});

test("rejects vulnerable h2 from a production feature graph", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waiverConfigured: true,
        profiles: {
          desktop: vulnerableGraph,
          server: patchedGraph,
          pi: patchedGraph,
          devtools: vulnerableGraph,
        },
      }),
    /desktop feature graph contains h2 0\.3\.27/,
  );
});

test("rejects vulnerable h2 from the Pi production feature graph", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waiverConfigured: true,
        profiles: {
          desktop: patchedGraph,
          server: patchedGraph,
          pi: vulnerableGraph,
          devtools: vulnerableGraph,
        },
      }),
    /pi feature graph contains h2 0\.3\.27/,
  );
});

test("rejects a stale waiver after the devtools dependency is patched", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waiverConfigured: true,
        profiles: {
          desktop: patchedGraph,
          server: patchedGraph,
          pi: patchedGraph,
          devtools: patchedGraph,
        },
      }),
    /remove the stale RUSTSEC-2026-0258 waiver/,
  );
});

test("rejects an unwaived vulnerable devtools graph", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waiverConfigured: false,
        profiles: {
          desktop: patchedGraph,
          server: patchedGraph,
          pi: patchedGraph,
          devtools: vulnerableGraph,
        },
      }),
    /requires the reviewed RUSTSEC-2026-0258 waiver/,
  );
});
