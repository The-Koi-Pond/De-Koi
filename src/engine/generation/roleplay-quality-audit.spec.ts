import { describe, expect, it } from "vitest";

import type { AgentResult } from "../contracts/types/agent";
import { validateRoleplayQualityAudit } from "./roleplay-quality-audit";

const original = 'Mira closes the ledger. "I accept," Celia says.';

function result(data: unknown, overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agentId: "editor",
    agentType: "editor",
    type: "text_rewrite",
    data,
    tokensUsed: 42,
    durationMs: 321,
    success: true,
    error: null,
    ...overrides,
  };
}

describe("roleplay quality audit validation", () => {
  it("accepts a full corrected response with typed source-backed reasons", () => {
    const repair = validateRoleplayQualityAudit(
      original,
      result({
        editedText: 'Mira closes the ledger. "Decide when you are ready."',
        changes: [
          {
            reason: "agency",
            description: "Removed dialogue assigned to the persona.",
            evidence: '"I accept," Celia says.',
          },
        ],
      }),
    );

    expect(repair).toEqual({
      content: 'Mira closes the ledger. "Decide when you are ready."',
      changed: true,
      reasons: ["agency"],
      evidence: ['"I accept," Celia says.'],
      durationMs: 321,
    });
  });

  it("treats an unchanged response as a no-op", () => {
    expect(validateRoleplayQualityAudit(original, result({ editedText: `  ${original}  `, changes: [] }))).toEqual({
      content: original,
      changed: false,
      reasons: [],
      evidence: [],
      durationMs: 321,
    });
  });

  it.each([
    ["failed result", result(null, { success: false, error: "provider failed" })],
    ["empty text", result({ editedText: "", changes: [{ reason: "agency", description: "Changed it." }] })],
    [
      "unsupported reason",
      result({ editedText: "Edited.", changes: [{ reason: "style", description: "Changed style." }] }),
    ],
    [
      "unrelated source evidence",
      result({
        editedText: "Edited.",
        changes: [{ reason: "agency", description: "Changed it.", evidence: "A line that never appeared." }],
      }),
    ],
    [
      "missing source evidence",
      result({ editedText: "Edited.", changes: [{ reason: "agency", description: "Changed it." }] }),
    ],
    ["missing changes", result({ editedText: "Edited." })],
    [
      "internal tags",
      result({
        editedText: "<assistant_response>Edited.</assistant_response>",
        changes: [{ reason: "agency", description: "Changed it." }],
      }),
    ],
    [
      "editor JSON",
      result({
        editedText: '{"editedText":"Edited.","changes":[]}',
        changes: [{ reason: "agency", description: "Changed it." }],
      }),
    ],
    [
      "arbitrary JSON object",
      result({
        editedText: '{"answer":"Edited."}',
        changes: [{ reason: "agency", description: "Changed it.", evidence: '"I accept," Celia says.' }],
      }),
    ],
    [
      "duplicated original",
      result({
        editedText: `${original}\n\nMira closes the ledger.`,
        changes: [{ reason: "agency", description: "Changed it." }],
      }),
    ],
    [
      "duplicated original after new prose",
      result({
        editedText: `Mira closes the ledger.\n\n${original}`,
        changes: [{ reason: "agency", description: "Changed it.", evidence: '"I accept," Celia says.' }],
      }),
    ],
  ])("preserves the original for %s", (_label, auditResult) => {
    expect(validateRoleplayQualityAudit(original, auditResult)).toEqual(
      expect.objectContaining({ content: original, changed: false, reasons: [], evidence: [] }),
    );
  });

  it("rejects a typed reason that the triggering signal did not authorize", () => {
    const repair = validateRoleplayQualityAudit(
      original,
      result({
        editedText: "Mira closes the ledger.",
        changes: [
          {
            reason: "continuity",
            description: "Changed an unrelated detail.",
            evidence: "Mira closes the ledger.",
          },
        ],
      }),
      { allowedReasons: ["agency"] },
    );

    expect(repair).toEqual(expect.objectContaining({ content: original, changed: false, reasons: [], evidence: [] }));
  });

  it("bounds and deduplicates correction metadata", () => {
    const longEvidence = "x".repeat(400);
    const source = `${original} ${longEvidence}`;
    const repair = validateRoleplayQualityAudit(
      source,
      result({
        editedText: "Mira closes the ledger.",
        changes: [
          { reason: "agency", description: "First.", evidence: "Mira closes the ledger." },
          { reason: "agency", description: "Second.", evidence: "Mira closes the ledger." },
          { reason: "continuity", description: "Third.", evidence: longEvidence },
        ],
      }),
    );

    expect(repair.reasons).toEqual(["agency", "continuity"]);
    expect(repair.evidence).toHaveLength(2);
    expect(repair.evidence[1]!.length).toBeLessThanOrEqual(240);
  });
});
