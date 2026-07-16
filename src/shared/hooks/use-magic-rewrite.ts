import { useEffect, useState } from "react";
import { connectionCatalogApi } from "../api/connection-catalog-api";
import { llmApi } from "../api/llm-api";

const PROMPT_KEY = "magic-rewrite-prompt";

const REWRITE_SYSTEM_PROMPT = `You are a rewriting assistant for roleplay, fiction, and worldbuilding content.
Rewrite or generate the requested text according to the user's instructions.
Return ONLY the rewritten text -- no explanations, no markdown fences, no preamble.`;

function readStoredInstruction() {
  try {
    return window.localStorage.getItem(PROMPT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredInstruction(instruction: string) {
  try {
    window.localStorage.setItem(PROMPT_KEY, instruction);
  } catch {
    // Ignore storage failures; the rewrite flow still works without persistence.
  }
}

function buildRewriteMessages(value: string, instructionValue: string) {
  const text = value.trim();
  const hasSourceText = text.length > 0;
  const instruction =
    instructionValue.trim() ||
    (hasSourceText ? "Improve this text while preserving its meaning." : "Generate suitable content.");

  return [
    { role: "system" as const, content: REWRITE_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: hasSourceText
        ? `Instruction:\n${instruction}\n\n---\n\nText to rewrite:\n${value}`
        : `Instruction:\n${instruction}\n\n---\n\nNo source text was provided; generate new content from the instruction.`,
    },
  ];
}

export function useMagicRewrite(value: string) {
  const [instruction, setInstruction] = useState(readStoredInstruction);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => writeStoredInstruction(instruction), 300);
    return () => window.clearTimeout(timer);
  }, [instruction]);

  async function generate() {
    setLoading(true);
    setError("");
    setResult("");
    try {
      const connectionId = await connectionCatalogApi.resolveDefaultTextConnectionId();
      const text = await llmApi.complete({
        connectionId,
        messages: buildRewriteMessages(value, instruction),
        parameters: { temperature: 0.7, maxTokens: 4000 },
      });
      setResult(text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Magic Rewrite failed");
    } finally {
      setLoading(false);
    }
  }

  return {
    instruction,
    setInstruction,
    result,
    loading,
    error,
    generate,
  };
}
