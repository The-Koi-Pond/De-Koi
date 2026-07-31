import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../contracts/types/agent";
import type { BaseLLMProvider, ChatMessage } from "../../generation-core/llm/base-provider";
import { createAgentPipeline, type ResolvedAgent } from "./agent-pipeline";

function agentContext(): AgentContext {
  return {
    chatId: "chat-1",
    chatMode: "roleplay",
    recentMessages: [],
    mainResponse: null,
    gameState: null,
    characters: [],
    persona: null,
    memory: {},
    activatedLorebookEntries: null,
    writableLorebookIds: null,
    chatSummary: null,
    streaming: false,
  };
}

function providerWithConcurrencyProbe() {
  let active = 0;
  let maxActive = 0;
  const calls: string[] = [];
  const provider: BaseLLMProvider = {
    maxTokensOverrideValue: null,
    async chatComplete(messages: ChatMessage[]) {
      const prompt = messages.map((message) => message.content).join("\n");
      const kind = prompt.includes('agent_task id="prose-guardian"')
        ? "batch"
        : (prompt.match(/PROMPT_KIND:([a-z-]+)/)?.[1] ?? "expression");
      calls.push(kind);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return {
        content: responseForKind(kind),
      };
    },
  };
  return { provider, calls, getMaxActive: () => maxActive };
}

function responseForKind(kind: string): string {
  if (kind === "batch") {
    return '<result agent="prose-guardian">Keep the prose tight.</result><result agent="director">[Director\'s note: Keep moving.]</result>';
  }
  if (kind === "expression") {
    return JSON.stringify({ characterName: "Mari", expression: "focused" });
  }
  return JSON.stringify({ updates: [] });
}

function resolvedAgent(
  type: string,
  provider: BaseLLMProvider,
  maxParallelJobs: number,
  settings: Record<string, unknown> = {},
): ResolvedAgent {
  return {
    id: type,
    type,
    name: type,
    phase: "parallel",
    promptTemplate: `PROMPT_KIND:${type}\n${type === "expression" ? "Return expression JSON." : "Return a concise note."}`,
    connectionId: "connection-1",
    settings,
    provider,
    model: "test-model",
    maxParallelJobs,
  };
}

describe("agent pipeline scheduling", () => {
  it("overlaps batchable and individual jobs when the connection cap allows it", async () => {
    const { provider, calls, getMaxActive } = providerWithConcurrencyProbe();
    const pipeline = createAgentPipeline(
      [
        resolvedAgent("prose-guardian", provider, 2),
        resolvedAgent("director", provider, 2),
        resolvedAgent("expression", provider, 2),
      ],
      agentContext(),
    );

    const results = await pipeline.runParallel();

    expect(results.map((result) => result.agentType).sort()).toEqual(["director", "expression", "prose-guardian"]);
    expect(calls.sort()).toEqual(["batch", "expression"]);
    expect(getMaxActive()).toBe(2);
  });

  it("keeps mixed jobs serial when the connection cap is one", async () => {
    const { provider, calls, getMaxActive } = providerWithConcurrencyProbe();
    const pipeline = createAgentPipeline(
      [
        resolvedAgent("prose-guardian", provider, 1),
        resolvedAgent("director", provider, 1),
        resolvedAgent("expression", provider, 1),
      ],
      agentContext(),
    );

    const results = await pipeline.runParallel();

    expect(results.map((result) => result.agentType).sort()).toEqual(["director", "expression", "prose-guardian"]);
    expect(calls).toEqual(["batch", "expression"]);
    expect(getMaxActive()).toBe(1);
  });

  it("keeps executor-isolated agents inside the connection concurrency cap", async () => {
    const { provider, calls, getMaxActive } = providerWithConcurrencyProbe();
    const pipeline = createAgentPipeline(
      [
        resolvedAgent("world-state", provider, 2),
        resolvedAgent("lorebook-keeper", provider, 2),
        resolvedAgent("expression", provider, 2),
      ],
      agentContext(),
    );

    const results = await pipeline.runParallel();

    expect(results.map((result) => result.agentType).sort()).toEqual(["expression", "lorebook-keeper", "world-state"]);
    expect(calls.sort()).toEqual(["expression", "lorebook-keeper", "world-state"]);
    expect(getMaxActive()).toBeLessThanOrEqual(2);
  });

  it("parses Narrative Craft JSON after a completed response without injecting into that response", async () => {
    let seenPrompt = "";
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages: ChatMessage[]) {
        seenPrompt = messages.map((message) => message.content).join("\n");
        return {
          content: JSON.stringify({
            text: "Move the scene outside and make the weather carry the tension.",
            evidence: [
              "They shook hands, the argument already forgotten.",
              "By morning, every disagreement had been neatly resolved.",
            ],
            issue: "tidy-resolution",
            state: {
              version: 1,
              pacing: "quiet",
              threads: [],
              openQuestions: [],
              withheldInformation: [],
              unresolvedConsequences: [],
              recentShapeChoices: [],
              lastGuidance: ["Move the scene outside and make the weather carry the tension."],
            },
            reason: "The previous turns resolved tension too quickly.",
            intervened: true,
          }),
        };
      },
    };
    const context = agentContext();
    context.recentMessages = [
      {
        role: "assistant",
        content: "They shook hands, the argument already forgotten.",
      },
      { role: "user", content: "Continue." },
    ];
    context.memory._narrativeCraftState = { version: 1, pacing: "quiet", threads: [] };
    const agent: ResolvedAgent = {
      ...resolvedAgent("narrative-craft", provider, 1),
      name: "Narrative Craft",
      phase: "post_processing",
      promptTemplate: "Return Narrative Craft JSON.",
    };
    const pipeline = createAgentPipeline([agent], context);

    await expect(
      pipeline.postGenerate("By morning, every disagreement had been neatly resolved."),
    ).resolves.toEqual([
      expect.objectContaining({
        agentType: "narrative-craft",
        data: expect.objectContaining({
          text:
            "Avoid forcing a tidy resolution or summarizing closure in the next reply. Preserve the requested scene content, live threads, and character agency.",
        }),
      }),
    ]);
    expect(pipeline.results[0]).toMatchObject({
      agentType: "narrative-craft",
      type: "context_injection",
      success: true,
      data: {
        text:
          "Avoid forcing a tidy resolution or summarizing closure in the next reply. Preserve the requested scene content, live threads, and character agency.",
        evidence: [
          "They shook hands, the argument already forgotten.",
          "By morning, every disagreement had been neatly resolved.",
        ],
        issue: "tidy-resolution",
        intervened: true,
        state: {
          lastGuidance: [
            "Avoid forcing a tidy resolution or summarizing closure in the next reply. Preserve the requested scene content, live threads, and character agency.",
          ],
        },
      },
    });
    expect(seenPrompt).toContain("<narrative_craft_state>");
    expect(seenPrompt).toContain('"pacing":"quiet"');
    expect(seenPrompt).toContain("<assistant_response>");
    expect(seenPrompt).toContain("By morning, every disagreement had been neatly resolved.");
  });

  it("accepts the first grounded evidence pair when a provider nests multiple candidate pairs", async () => {
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        return {
          content: JSON.stringify({
            text: "",
            evidence: [
              [
                "She wiped the counter. It didn't need wiping.",
                "She wiped down the counter, though it didn't need wiping.",
              ],
              ["The olive loaves sat in their row.", "The olive loaves waited in their row."],
            ],
            issue: "repeated-shape",
            state: { lastGuidance: [] },
            reason: "The counter-wiping gesture has become a repeated closing shape.",
            intervened: true,
          }),
        };
      },
    };
    const context = agentContext();
    context.recentMessages = [
      {
        role: "assistant",
        content:
          "She wiped down the counter, though it didn't need wiping. The olive loaves waited in their row.",
      },
    ];
    const pipeline = createAgentPipeline(
      [
        {
          ...resolvedAgent("narrative-craft", provider, 1),
          phase: "post_processing",
          promptTemplate: "Return Narrative Craft JSON.",
        },
      ],
      context,
    );

    const [result] = await pipeline.postGenerate(
      "She wiped the counter. It didn't need wiping. The olive loaves sat in their row.",
    );

    expect(result?.data).toMatchObject({
      evidence: [
        "She wiped the counter. It didn't need wiping.",
        "She wiped down the counter, though it didn't need wiping.",
      ],
      issue: "repeated-shape",
      intervened: true,
    });
  });

  it("updates Narrative Craft state without guidance when completed prose does not ground the evidence", async () => {
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        return {
          content: JSON.stringify({
            text: "Make the setting reflect the character's grief.",
            evidence: ["The room felt empty.", "Rain carried the grief."],
            issue: "mirrored-setting",
            state: {
              version: 1,
              pacing: "quiet",
              threads: [{ id: "grief", summary: "A fresh loss", kind: "main", status: "active" }],
              lastGuidance: ["Make the setting reflect the character's grief."],
            },
            reason: "The opening would benefit from a symbolic setting.",
            intervened: true,
          }),
        };
      },
    };
    const agent: ResolvedAgent = {
      ...resolvedAgent("narrative-craft", provider, 1),
      phase: "post_processing",
      promptTemplate: "Return Narrative Craft JSON.",
    };
    const context = agentContext();
    context.recentMessages = [{ role: "user", content: "Write an opening about grief." }];
    const pipeline = createAgentPipeline([agent], context);

    await expect(pipeline.postGenerate("The opening remains spare and concrete.")).resolves.toEqual([
      expect.objectContaining({ agentType: "narrative-craft", success: true }),
    ]);
    expect(pipeline.results[0]).toMatchObject({
      agentType: "narrative-craft",
      success: true,
      data: {
        text: "",
        evidence: [],
        intervened: false,
        reason: "Narrative Craft did not cite two different exact excerpts from existing assistant prose.",
        state: {
          pacing: "quiet",
          threads: [{ id: "grief" }],
          lastGuidance: [],
        },
      },
    });
  });

  it("suppresses Narrative Craft guidance whose evidence is not in assistant prose", async () => {
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        return {
          content: JSON.stringify({
            text: "Replace the repeated sentence openings.",
            evidence: ["Mara crossed the room.", "Every sentence began with She."],
            issue: "repeated-shape",
            state: {
              version: 1,
              pacing: "building",
              threads: [],
              lastGuidance: ["Replace the repeated sentence openings."],
            },
            reason: "The prose repeats one sentence shape.",
            intervened: true,
          }),
        };
      },
    };
    const agent: ResolvedAgent = {
      ...resolvedAgent("narrative-craft", provider, 1),
      phase: "post_processing",
      promptTemplate: "Return Narrative Craft JSON.",
    };
    const context = agentContext();
    context.recentMessages = [
      { role: "assistant", content: "Mara crossed the room. Outside, rain tapped the glass." },
      { role: "user", content: "Continue." },
    ];
    const pipeline = createAgentPipeline([agent], context);

    await expect(pipeline.postGenerate("The window stayed shut.")).resolves.toEqual([
      expect.objectContaining({ agentType: "narrative-craft", success: true }),
    ]);
    expect(pipeline.results[0]).toMatchObject({
      success: true,
      data: {
        text: "",
        evidence: [],
        intervened: false,
        reason: "Narrative Craft did not cite two different exact excerpts from existing assistant prose.",
        state: { pacing: "building", lastGuidance: [] },
      },
    });
  });

  it("keeps a successful silent Narrative Craft result without adding an injection", async () => {
    let seenPrompt = "";
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages: ChatMessage[]) {
        seenPrompt = messages.map((message) => message.content).join("\n");
        return {
          content: JSON.stringify({
            text: "",
            evidence: [],
            issue: "",
            state: { version: 1, pacing: "exploring", threads: [], lastGuidance: ["stale guidance"] },
            reason: "No material intervention is needed.",
            intervened: false,
          }),
        };
      },
    };
    const agent: ResolvedAgent = {
      ...resolvedAgent("narrative-craft", provider, 1),
      phase: "post_processing",
      promptTemplate: "Return Narrative Craft JSON.",
    };
    const pipeline = createAgentPipeline([agent], agentContext());

    await expect(pipeline.postGenerate("Nothing in the reply needs correction.")).resolves.toEqual([
      expect.objectContaining({ agentType: "narrative-craft", success: true }),
    ]);
    expect(pipeline.results[0]).toMatchObject({
      agentType: "narrative-craft",
      type: "context_injection",
      success: true,
      data: { text: "", evidence: [], issue: "", intervened: false, state: { lastGuidance: [] } },
    });
    expect(seenPrompt).not.toContain("<narrative_craft_state>");
  });
});
