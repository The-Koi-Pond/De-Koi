import { describe, expect, it } from "vitest";
import type { LlmMessage } from "../capabilities/llm";
import { estimateLlmMessageTokens } from "./context-window";
import { buildPromptBudgetEstimate } from "./prompt-budget";

type BudgetMessage = LlmMessage & {
  contextKind?: "prompt" | "history" | "injection";
  displayName?: string;
};

function message(input: BudgetMessage): BudgetMessage {
  return input;
}

describe("prompt budget estimates", () => {
  it("uses the same message token estimate as context fitting", () => {
    const prompt = message({
      role: "user",
      content: "A short prompt with an image and a tool call.",
      images: ["data:image/png;base64,abc"],
      tool_calls: [{ name: "lookup", arguments: { id: "entry-1" } }],
    });

    const budget = buildPromptBudgetEstimate({
      messages: [prompt],
      connection: null,
      parameters: {},
    });

    expect(budget.estimatedPromptTokens).toBe(estimateLlmMessageTokens(prompt));
  });

  it("groups prompt messages into major budget sections", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [
        message({ role: "system", content: "Preset rules.", contextKind: "prompt", displayName: "System Prompt" }),
        message({ role: "system", content: "Character facts.", contextKind: "prompt", displayName: "Character Info" }),
        message({ role: "system", content: "Persona facts.", contextKind: "prompt", displayName: "Persona" }),
        message({ role: "system", content: "World facts.", contextKind: "prompt", displayName: "Lorebook" }),
        message({ role: "system", content: "Memory recall.", contextKind: "prompt", displayName: "Memory Recall" }),
        message({ role: "user", content: "Old chat.", contextKind: "history" }),
        message({ role: "system", content: "Connected command.", contextKind: "injection", displayName: "Spotify" }),
      ],
      connection: { maxContext: 4096 },
      parameters: { maxTokens: 512 },
    });

    expect(budget.sections.map((section) => section.kind)).toEqual([
      "preset",
      "character",
      "persona",
      "lorebook",
      "memory",
      "history",
      "injection",
    ]);
  });

  it("reports remaining budget and likely history trimming when prompt exceeds the input budget", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [
        message({ role: "system", content: "Fixed prompt. ".repeat(40), contextKind: "prompt" }),
        message({ role: "user", content: "Old history. ".repeat(160), contextKind: "history" }),
      ],
      connection: { maxContext: 700 },
      parameters: { maxTokens: 120 },
    });

    expect(budget.contextLimit).toBe(700);
    expect(budget.remainingTokens).toBeLessThan(0);
    expect(budget.warnings.some((warning) => warning.kind === "over_budget")).toBe(true);
    expect(budget.warnings.some((warning) => warning.kind === "history_trim")).toBe(true);
    expect(budget.sections.find((section) => section.kind === "history")?.trimRisk).toBe("high");
  });

  it("warns about skipped lorebook entries and unusually large sections", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [
        message({ role: "system", content: "Lore ".repeat(900), contextKind: "prompt", displayName: "Lorebook" }),
      ],
      connection: { maxContext: 8192 },
      parameters: { maxTokens: 512 },
      budgetSkippedLorebookEntries: [{ id: "entry-1", lorebookId: "book-1", name: "Huge Entry" }],
    });

    expect(budget.sections[0]?.kind).toBe("lorebook");
    expect(budget.warnings.some((warning) => warning.kind === "large_section")).toBe(true);
    expect(budget.warnings.some((warning) => warning.kind === "lorebook_skipped")).toBe(true);
  });

  it("clamps the input budget when reserves exceed a tiny context limit", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [message({ role: "user", content: "Tiny window prompt." })],
      connection: { maxContext: 128 },
      parameters: { maxTokens: 256 },
    });

    expect(budget.inputBudgetTokens).toBe(0);
    expect(budget.remainingTokens).toBeLessThan(0);
    expect(budget.warnings.some((warning) => warning.kind === "over_budget")).toBe(true);
  });
  it("keeps estimates honest when the context limit is unknown", () => {
    const budget = buildPromptBudgetEstimate({
      messages: [message({ role: "system", content: "Prompt without a known model window." })],
      connection: null,
      parameters: {},
    });

    expect(budget.contextLimit).toBeNull();
    expect(budget.remainingTokens).toBeNull();
    expect(budget.warnings.some((warning) => warning.kind === "unknown_limit")).toBe(true);
  });
});
