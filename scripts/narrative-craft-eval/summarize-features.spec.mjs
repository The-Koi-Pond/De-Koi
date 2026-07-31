import test from "node:test";
import assert from "node:assert/strict";

import { summarizeFeatureRows } from "./summarize-features.mjs";

const metric = (caseId, condition, featureId, present, overrides = {}) => ({
  caseId,
  condition,
  model: "provider/model",
  seed: "1",
  latencyMs: condition === "baseline" ? 100 : 110,
  inputTokens: condition === "baseline" ? 20 : 22,
  outputTokens: condition === "baseline" ? 30 : 28,
  featureId,
  present,
  ...overrides,
});

test("compares matched pairs per feature and reports aggregate performance deltas", () => {
  const summary = summarizeFeatureRows([
    metric("case-a", "baseline", "forced_escalation", true),
    metric("case-a", "treatment", "forced_escalation", false),
    metric("case-b", "baseline", "forced_escalation", true, { latencyMs: 200 }),
    metric("case-b", "treatment", "forced_escalation", true, { latencyMs: 180 }),
  ]);

  assert.equal(summary.matchedPairs, 2);
  assert.deepEqual(summary.missingPairs, []);
  assert.deepEqual(summary.features[0], {
    featureId: "forced_escalation",
    matchedPairs: 2,
    baselinePresent: 2,
    treatmentPresent: 1,
    baselineRate: 1,
    treatmentRate: 0.5,
    delta: -0.5,
  });
  assert.deepEqual(summary.performance.latencyMs, { baselineMedian: 150, treatmentMedian: 145, delta: -5 });
  assert.deepEqual(summary.performance.inputTokens, { baselineTotal: 40, treatmentTotal: 44, delta: 4 });
  assert.deepEqual(summary.performance.outputTokens, { baselineTotal: 60, treatmentTotal: 56, delta: -4 });
  assert.equal("score" in summary, false);
});

test("reports unmatched baseline or treatment identities instead of silently dropping them", () => {
  const summary = summarizeFeatureRows([
    metric("case-a", "baseline", "forced_escalation", true),
    metric("case-a", "treatment", "forced_escalation", false),
    metric("case-b", "baseline", "forced_escalation", true),
  ]);

  assert.equal(summary.matchedPairs, 1);
  assert.deepEqual(summary.missingPairs, [
    { caseId: "case-b", model: "provider/model", seed: "1", missingCondition: "treatment" },
  ]);
});

test("does not invent a zero latency delta when no complete pairs exist", () => {
  const summary = summarizeFeatureRows([metric("case-a", "baseline", "forced_escalation", true)]);

  assert.deepEqual(summary.performance.latencyMs, {
    baselineMedian: null,
    treatmentMedian: null,
    delta: null,
  });
});
