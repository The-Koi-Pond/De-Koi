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
});
