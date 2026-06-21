import { describe, expect, it } from "vitest";

import { createAgentConfigSchema } from "../../../../engine/contracts/schemas/agent.schema";
import { agentCreditLabel } from "./use-agents";

describe("agent author metadata", () => {
  it("leaves missing custom agent author empty at the schema boundary", () => {
    const parsed = createAgentConfigSchema.parse({
      type: "custom-agent",
      name: "Custom Agent",
      phase: "post_processing",
    });

    expect(parsed.credit).toBe("");
  });

  it("does not replace an intentionally empty custom author with the built-in credit", () => {
    expect(agentCreditLabel("")).toBe("");
    expect(agentCreditLabel("  Celia  ")).toBe("Celia");
  });
});
