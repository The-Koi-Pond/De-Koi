import { describe, expect, it } from "vitest";

import {
  buildLongRoleplayMemoryEvaluationFixture,
  evaluateMemoryRecallCases,
  recommendedMemoryRecallDefaults,
} from "./memory-recall-evaluation";

describe("memory recall evaluation pack", () => {
  it("builds long RP fixtures with recall, contradiction, edit/delete, time skip, relationship, and branch coverage", () => {
    const fixture = buildLongRoleplayMemoryEvaluationFixture();

    expect(fixture.turns.length).toBeGreaterThanOrEqual(50);
    expect(fixture.coverage).toEqual(
      expect.objectContaining({
        recallQuestions: true,
        contradictionsAndSupersession: true,
        timeSkips: true,
        relationshipChanges: true,
        messageEditsAndDeletes: true,
        branchyScenes: true,
        multipleParticipants: true,
        migrationCorrectness: true,
        userCorrectionBehavior: true,
      }),
    );
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
  });

  it("shows hybrid canonical retrieval improves recall without stale false canon or prompt bloat", () => {
    const fixture = buildLongRoleplayMemoryEvaluationFixture();
    const vectorOnly = evaluateMemoryRecallCases(fixture.cases, { mode: "vector_only" });
    const lexicalFallback = evaluateMemoryRecallCases(fixture.cases, { mode: "lexical_fallback" });
    const hybrid = evaluateMemoryRecallCases(fixture.cases, { mode: "hybrid" });
    const hybridWithoutStaleFilter = evaluateMemoryRecallCases(fixture.cases, {
      mode: "hybrid_without_stale_superseded_filtering",
    });

    expect(hybrid.totals.correctRecall).toBeGreaterThan(vectorOnly.totals.correctRecall);
    expect(hybrid.totals.correctRecall).toBeGreaterThanOrEqual(lexicalFallback.totals.correctRecall);
    expect(hybrid.totals.missingRecall).toBe(0);
    expect(hybrid.totals.wrongRecall).toBe(0);
    expect(hybrid.totals.staleSupersededRecall).toBe(0);
    expect(hybridWithoutStaleFilter.totals.staleSupersededRecall).toBeGreaterThan(0);
    expect(hybrid.totals.tokenCost).toBeLessThanOrEqual(recommendedMemoryRecallDefaults.defaultBudgetTokens);
    expect(hybrid.totals.extractionFailures).toBe(1);
    expect(hybrid.totals.userCorrectionCases).toBe(1);
    expect(hybrid.totals.migrationCorrectnessCases).toBeGreaterThanOrEqual(2);
  });
});
