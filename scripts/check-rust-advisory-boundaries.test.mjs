import assert from "node:assert/strict";
import test from "node:test";

import {
  RUST_ADVISORY_PROFILES,
  evaluateRustAdvisoryBoundaries,
  parseWaivedAdvisories,
} from "./check-rust-advisory-boundaries.mjs";

const patchedGraph = "de-koi v1.6.1\nh2 v0.4.16\nringbuf v0.5.2";
const vulnerableGraph = "de-koi v1.6.1\nh2 v0.3.27\nringbuf v0.4.8\ntauri-plugin-devtools v2.1.0";
const h2OnlyGraph = "de-koi v1.6.1\nh2 v0.3.27\ntauri-plugin-devtools v2.1.0";
const bothWaivers = ["RUSTSEC-2026-0258", "RUSTSEC-2026-0293"];

function profiles(overrides = {}) {
  return { desktop: patchedGraph, server: patchedGraph, pi: patchedGraph, devtools: vulnerableGraph, ...overrides };
}

test("resolves the Pi profile for the ARM64 Linux production target", () => {
  assert.deepEqual(RUST_ADVISORY_PROFILES.pi, {
    features: "server",
    target: "aarch64-unknown-linux-gnu",
  });
});

test("accepts the temporary waivers only when the vulnerable crates are devtools-only", () => {
  assert.doesNotThrow(() => evaluateRustAdvisoryBoundaries({ waivedAdvisories: bothWaivers, profiles: profiles() }));
});

test("rejects vulnerable h2 from a production feature graph", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waivedAdvisories: bothWaivers,
        profiles: profiles({ desktop: vulnerableGraph }),
      }),
    /desktop feature graph contains h2 0\.3\.27/,
  );
});

test("rejects vulnerable h2 from the Pi production feature graph", () => {
  assert.throws(
    () => evaluateRustAdvisoryBoundaries({ waivedAdvisories: bothWaivers, profiles: profiles({ pi: h2OnlyGraph }) }),
    /pi feature graph contains h2 0\.3\.27/,
  );
});

test("rejects vulnerable ringbuf from a production feature graph", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waivedAdvisories: bothWaivers,
        profiles: profiles({ server: "de-koi v1.6.1\nringbuf v0.4.8" }),
      }),
    /server feature graph contains ringbuf < 0\.5\.2 \(RUSTSEC-2026-0293\)/,
  );
});

test("rejects a stale h2 waiver after the devtools dependency is patched", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({
        waivedAdvisories: bothWaivers,
        profiles: profiles({ devtools: "de-koi v1.6.1\nh2 v0.4.16\nringbuf v0.4.8" }),
      }),
    /remove the stale RUSTSEC-2026-0258 waiver/,
  );
});

test("rejects a stale ringbuf waiver after the devtools dependency is patched", () => {
  assert.throws(
    () =>
      evaluateRustAdvisoryBoundaries({ waivedAdvisories: bothWaivers, profiles: profiles({ devtools: h2OnlyGraph }) }),
    /remove the stale RUSTSEC-2026-0293 waiver/,
  );
});

test("rejects an unwaived vulnerable devtools graph", () => {
  assert.throws(
    () => evaluateRustAdvisoryBoundaries({ waivedAdvisories: ["RUSTSEC-2026-0293"], profiles: profiles() }),
    /requires the reviewed RUSTSEC-2026-0258 waiver/,
  );
  assert.throws(
    () => evaluateRustAdvisoryBoundaries({ waivedAdvisories: ["RUSTSEC-2026-0258"], profiles: profiles() }),
    /requires the reviewed RUSTSEC-2026-0293 waiver/,
  );
});

test("reads waivers only from the active advisories ignore list", () => {
  const config = [
    "[advisories]",
    "version = 2",
    '# Old note: "RUSTSEC-2026-0258" used to be waived here.',
    'ignore = ["RUSTSEC-2026-0293"] # "RUSTSEC-2026-9999" in a trailing comment',
    "",
    "[bans]",
    'ignore = ["RUSTSEC-2026-0001"]',
  ].join("\n");

  assert.deepEqual(parseWaivedAdvisories(config), ["RUSTSEC-2026-0293"]);
});

test("reads a multi-line ignore list", () => {
  const config = [
    "[advisories]",
    "ignore = [",
    '  "RUSTSEC-2026-0258",',
    '  # "RUSTSEC-2026-0001",',
    '  "RUSTSEC-2026-0293",',
    "]",
    "",
  ].join("\n");

  assert.deepEqual(parseWaivedAdvisories(config), ["RUSTSEC-2026-0258", "RUSTSEC-2026-0293"]);
});
