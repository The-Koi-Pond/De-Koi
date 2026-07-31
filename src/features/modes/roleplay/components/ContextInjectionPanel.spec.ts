import { describe, expect, it } from "vitest";

import { normalizeVisibleContextInjections } from "./ContextInjectionPanel";

describe("cached context injection normalization", () => {
  it("hides current and retired narrative guidance while preserving specialist injections", () => {
    expect(
      normalizeVisibleContextInjections([
        "legacy prose guidance",
        { agentType: "narrative-craft", text: "current craft guidance" },
        { agentType: "prose-guardian", text: "retired prose guidance" },
        { agentType: "director", text: "retired direction" },
        { agentType: "secret-plot-driver", text: "retired plot direction" },
        { agentType: "continuity", agentName: "Continuity Checker", text: "Keep the date consistent." },
      ]),
    ).toEqual([
      {
        agentType: "continuity",
        agentName: "Continuity Checker",
        text: "Keep the date consistent.",
      },
    ]);
  });
});
