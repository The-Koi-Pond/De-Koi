import test from "node:test";
import assert from "node:assert/strict";

import { validateCorpusRows } from "./validate-corpus.mjs";

const cases = [{ caseId: "case-a" }, { caseId: "case-b" }];
const baseline = {
  caseId: "case-a",
  condition: "baseline",
  model: "provider/model",
  seed: "1",
  text: "A complete generated passage.",
  latencyMs: 100,
  inputTokens: 20,
  outputTokens: 30,
};
const treatment = { ...baseline, condition: "treatment", text: "A different generated passage." };

test("accepts complete matched baseline and treatment rows", () => {
  assert.deepEqual(validateCorpusRows([baseline, treatment], cases), [baseline, treatment]);
});

test("rejects a missing matched condition", () => {
  assert.throws(() => validateCorpusRows([baseline], cases), /missing treatment/i);
});

test("rejects duplicate case, condition, model, and seed rows", () => {
  assert.throws(() => validateCorpusRows([baseline, baseline, treatment], cases), /duplicate/i);
});

test("rejects empty generated text", () => {
  assert.throws(() => validateCorpusRows([{ ...baseline, text: " " }, treatment], cases), /text/i);
});

test("rejects unknown case IDs", () => {
  assert.throws(
    () =>
      validateCorpusRows(
        [
          { ...baseline, caseId: "not-in-matrix" },
          { ...treatment, caseId: "not-in-matrix" },
        ],
        cases,
      ),
    /unknown case/i,
  );
});
