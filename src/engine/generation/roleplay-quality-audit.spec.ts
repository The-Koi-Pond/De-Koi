import { describe, expect, it } from "vitest";

import type { AgentResult } from "../contracts/types/agent";
import type { RoleplayQualitySignal, RoleplayQualitySignalKind } from "./roleplay-quality-signals";
import * as roleplayQualityAudit from "./roleplay-quality-audit";
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

function edit(before: string, after: string, reason = "agency", description = "Made a bounded correction.") {
  return { before, after, reason, description };
}

function signal(kind: RoleplayQualitySignalKind): RoleplayQualitySignal {
  return { kind, severity: "minor", evidence: ["source"], guidance: "Review it." };
}

describe("roleplay quality audit validation", () => {
  it("maps only triggering signal families to authorized editor reasons", () => {
    const mapReasons = Reflect.get(roleplayQualityAudit, "roleplayQualityReasonsForSignals") as
      | ((signals: RoleplayQualitySignal[]) => string[])
      | undefined;

    expect(mapReasons).toBeTypeOf("function");
    expect(
      mapReasons?.([
        signal("agency_candidate"),
        signal("identity_contradiction"),
        signal("repeated_phrase"),
        signal("length_mismatch"),
        signal("malformed_output"),
      ]),
    ).toEqual(["agency", "continuity", "repetition", "pacing", "malformed"]);
  });

  it.each([
    ["repeated_phrase", "repetition"],
    ["repeated_opening", "repetition"],
    ["repeated_closing", "repetition"],
    ["repeated_gesture", "repetition"],
    ["user_echo", "repetition"],
    ["rhetorical_repetition", "repetition"],
    ["cast_saturation", "pacing"],
    ["length_mismatch", "pacing"],
    ["malformed_output", "malformed"],
    ["identity_contradiction", "continuity"],
    ["agency_candidate", "agency"],
  ] satisfies Array<[RoleplayQualitySignalKind, string]>)("maps %s to the guarded %s editor reason", (kind, reason) => {
    expect(roleplayQualityAudit.roleplayQualityReasonsForSignals([signal(kind)])).toEqual([reason]);
  });

  it("applies one exact source-backed replacement without rewriting unrelated prose", () => {
    const repair = validateRoleplayQualityAudit(
      original,
      result({
        edits: [
          edit('"I accept," Celia says.', '"Your choice."', "agency", "Removed dialogue assigned to the persona."),
        ],
      }),
      { allowedReasons: ["agency"] },
    );

    expect(repair).toEqual({
      content: 'Mira closes the ledger. "Your choice."',
      changed: true,
      reasons: ["agency"],
      evidence: ['"I accept," Celia says.'],
      durationMs: 321,
    });
  });

  it("applies multiple non-overlapping replacements from the end of the source", () => {
    const source = "Mira slowly closes the ledger. The room stays silent.";
    const repair = validateRoleplayQualityAudit(
      source,
      result({
        edits: [
          edit("slowly ", "", "pacing", "Removed padding."),
          edit("stays silent", "waits", "repetition", "Varied a repeated beat."),
        ],
      }),
      { allowedReasons: ["pacing", "repetition"] },
    );

    expect(repair.content).toBe("Mira closes the ledger. The room waits.");
    expect(repair.reasons).toEqual(["pacing", "repetition"]);
    expect(repair.evidence).toEqual(["slowly", "stays silent"]);
  });

  it("treats an empty edit list as a no-op", () => {
    expect(validateRoleplayQualityAudit(original, result({ edits: [] }))).toEqual({
      content: original,
      changed: false,
      reasons: [],
      evidence: [],
      durationMs: 321,
    });
  });

  it.each([
    ["failed result", result(null, { success: false, error: "provider failed" }), original, ["agency"]],
    ["missing edits", result({}), original, ["agency"]],
    ["non-record edit", result({ edits: ["bad"] }), original, ["agency"]],
    ["empty before", result({ edits: [edit("", "New.")] }), original, ["agency"]],
    ["no-op edit", result({ edits: [edit("closes", "closes")] }), original, ["agency"]],
    ["unsupported reason", result({ edits: [edit("closes", "shuts", "style")] }), original, ["agency"]],
    ["unauthorized reason", result({ edits: [edit("closes", "shuts", "continuity")] }), original, ["agency"]],
    [
      "ambiguous before",
      result({ edits: [edit("Mira", "She", "continuity")] }),
      "Mira waits. Mira closes the ledger.",
      ["continuity"],
    ],
    [
      "overlapping edits",
      result({
        edits: [
          edit("Mira closes the ledger", "Mira shuts it", "pacing"),
          edit("closes the ledger", "shuts it", "pacing"),
        ],
      }),
      original,
      ["pacing"],
    ],
    [
      "longer result",
      result({ edits: [edit("closes", "very slowly and carefully closes", "pacing")] }),
      original,
      ["pacing"],
    ],
    ["internal tags", result({ edits: [edit("closes", "<analysis>shuts</analysis>")] }), original, ["agency"]],
    ["editor JSON", result({ edits: [edit("closes", '{"editedText":"shuts"}')] }), original, ["agency"]],
    ["arbitrary JSON", result({ edits: [edit("closes", '{"answer":"shuts"}')] }), original, ["agency"]],
    ["empty final reply", result({ edits: [edit(original, "")] }), original, ["agency"]],
    [
      "too many edits",
      result({ edits: Array.from({ length: 7 }, () => edit("closes", "shuts")) }),
      original,
      ["agency"],
    ],
  ])("preserves the original for %s", (_label, auditResult, source, allowedReasons) => {
    expect(
      validateRoleplayQualityAudit(source, auditResult, {
        allowedReasons: allowedReasons as Array<"agency" | "continuity" | "repetition" | "pacing" | "malformed">,
      }),
    ).toEqual(expect.objectContaining({ content: source, changed: false, reasons: [], evidence: [] }));
  });

  it("rejects the entire edit batch when one source span is ambiguous", () => {
    const source = "Mira waits. Mira closes the ledger.";
    const repair = validateRoleplayQualityAudit(
      source,
      result({
        edits: [
          edit("waits", "stops", "pacing", "Shortened a beat."),
          edit("Mira", "She", "continuity", "Changed an ambiguous repeated name."),
        ],
      }),
      { allowedReasons: ["pacing", "continuity"] },
    );

    expect(repair).toEqual({
      content: source,
      changed: false,
      reasons: [],
      evidence: [],
      durationMs: 321,
    });
  });

  it("bounds and deduplicates correction metadata", () => {
    const longEvidence = `evidence-${"x".repeat(400)}`;
    const source = `Mira closes the ledger. ${longEvidence}`;
    const repair = validateRoleplayQualityAudit(
      source,
      result({
        edits: [
          edit("Mira closes the ledger.", "Mira shuts the ledger.", "continuity", "First."),
          edit(longEvidence, "", "malformed", "Second."),
        ],
      }),
      { allowedReasons: ["continuity", "malformed"] },
    );

    expect(repair.reasons).toEqual(["continuity", "malformed"]);
    expect(repair.evidence).toHaveLength(2);
    expect(repair.evidence[1]!.length).toBeLessThanOrEqual(240);
  });
});
