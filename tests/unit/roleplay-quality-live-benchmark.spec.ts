import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../../src/engine/capabilities/llm";
import { analyzeRoleplayResponse } from "../../src/engine/generation/roleplay-quality-signals";
import { dryRunGeneration, type GenerationDryRunEvent } from "../../src/engine/generation/start-generation";
import { integrationGateway } from "../../src/shared/api/integration-gateway";
import { llmApi } from "../../src/shared/api/llm-api";
import { storageApi } from "../../src/shared/api/storage-api";
import { visualAssetsApi } from "../../src/shared/api/visual-assets-api";
import { useUIStore } from "../../src/shared/stores/ui.store";

const runtimeUrl = process.env.DE_KOI_LIVE_RUNTIME_URL?.trim() ?? "";
const connectionId = process.env.DE_KOI_LIVE_CONNECTION_ID?.trim() ?? "";
const liveTest = runtimeUrl && connectionId ? it : it.skip;

const CONTROLS = {
  strictAgency:
    "strict agency: never write {{user}}'s dialogue, intent, decisions, or deliberate actions. You may describe only involuntary reactions, immediate sensory perception, and consequences of choices the user already made.",
  grounded:
    "grounded prose: specific, tactile, and plain when possible; use imagery only when it changes action, knowledge, tension, or choice",
  lyrical:
    "lyrical prose: rhythmic and image-rich only where earned; keep figurative language sparse enough that action, motive, and consequence stay clear",
  balanced:
    "balanced pacing: favor one clean scene beat, one pressure shift, and a natural stop; let dialogue breathe, keep action concrete, and avoid padding when the scene already has a useful decision point",
  slowBurn:
    "slow-burn pacing: linger on subtext, atmosphere, hesitation, and small changes, but keep each detail tied to tension or choice",
  flexible:
    "flexible length: short when the user needs room to act; longer only for transitions, reveals, monologues, multi-character exchanges, or scene-setting that adds new usable state rather than polish",
  short: "under 150 words unless a sentence needs a little room to land",
  moderate: "150 to 300 words with a clear scene beat and a natural stopping point",
  sceneDraft:
    "scene-draft length when token budget allows, structured as polished prose rather than a recap or outline",
} as const;

type JsonRecord = Record<string, unknown>;

interface BenchmarkScenario {
  name: string;
  prompt: string;
  characterCount: number;
  promptVariables: Record<string, string>;
}

interface BenchmarkResult {
  name: string;
  content: string;
  correction: unknown;
  modelCalls: number;
  signals: string[];
  shouldAudit: boolean;
  auditRaw?: string;
}

function contentFromEvent(event: GenerationDryRunEvent): string {
  if (event.type !== "token") return "";
  return typeof event.data === "string" ? event.data : "";
}

async function collectDryRun(
  chatId: string,
  message: string,
  llm: LlmGateway,
): Promise<{ events: GenerationDryRunEvent[]; rawContent: string }> {
  const events: GenerationDryRunEvent[] = [];
  let rawContent = "";
  for await (const event of dryRunGeneration(
    {
      storage: storageApi,
      llm,
      integrations: integrationGateway,
      visuals: visualAssetsApi,
    },
    {
      chatId,
      connectionId,
      message,
      parameters: { temperature: 0 },
      runId: `roleplay-quality-live-${crypto.randomUUID()}`,
    },
  )) {
    events.push(event);
    rawContent += contentFromEvent(event);
  }
  return { events, rawContent };
}

function resultEvent(events: GenerationDryRunEvent[]): JsonRecord {
  const result = events.find((event) => event.type === "dry_run_result");
  return result && typeof result.data === "object" && result.data !== null
    ? (result.data as unknown as JsonRecord)
    : {};
}

function countingLlm(counter: { value: number }): LlmGateway {
  return {
    complete: (request, signal) => llmApi.complete(request, signal),
    completeRich: (request, signal) => llmApi.completeRich!(request, signal),
    embed: (request, signal) => llmApi.embed!(request, signal),
    listModels: (requestedConnectionId) => llmApi.listModels(requestedConnectionId),
    stream: async function* (request, signal) {
      counter.value += 1;
      yield* llmApi.stream(request, signal);
    },
  };
}

function injectedMainResponseLlm(
  candidate: string,
  counter: { value: number },
  capture: { auditRaw: string },
): LlmGateway {
  let streamCall = 0;
  return {
    complete: (request, signal) => llmApi.complete(request, signal),
    completeRich: (request, signal) => llmApi.completeRich!(request, signal),
    embed: (request, signal) => llmApi.embed!(request, signal),
    listModels: (requestedConnectionId) => llmApi.listModels(requestedConnectionId),
    stream: async function* (request: LlmRequest, signal?: AbortSignal) {
      streamCall += 1;
      counter.value += 1;
      if (streamCall === 1) {
        yield { type: "token", text: candidate } as const;
        return;
      }
      for await (const chunk of llmApi.stream(request, signal)) {
        if (chunk.type === "token" && typeof chunk.text === "string") capture.auditRaw += chunk.text;
        yield chunk;
      }
    },
  };
}

async function createBenchmarkChat(
  characterIds: string[],
  personaId: string | null,
  promptVariables: Record<string, string>,
): Promise<JsonRecord> {
  return storageApi.create<JsonRecord>("chats", {
    name: `Roleplay Quality Live Benchmark ${crypto.randomUUID()}`,
    mode: "roleplay",
    characterIds,
    personaId,
    promptPresetId: "preset_universal_v2",
    connectionId,
    metadata: { automaticRoleplayQualityCorrection: true },
    promptVariables: {
      agencyStrictness: CONTROLS.strictAgency,
      pacing: CONTROLS.balanced,
      styleFlavor: CONTROLS.grounded,
      length: CONTROLS.flexible,
      language: "English",
      ...promptVariables,
    },
  });
}

describe("live Roleplay prose quality benchmark", () => {
  liveTest(
    "runs a genre matrix and real focused-editor repairs against an isolated runtime",
    async () => {
      useUIStore.setState({ remoteRuntimeUrl: runtimeUrl });
      const characters = await storageApi.list<JsonRecord>("characters");
      const personas = await storageApi.list<JsonRecord>("personas");
      const usableCharacterIds = characters
        .map((character) => (typeof character.id === "string" ? character.id : ""))
        .filter(Boolean);
      const personaId = typeof personas[0]?.id === "string" ? personas[0].id : null;
      expect(usableCharacterIds.length).toBeGreaterThanOrEqual(4);

      const scenarios: BenchmarkScenario[] = [
        {
          name: "grounded-noir-dialogue",
          prompt:
            "The studio has emptied after a disastrous rehearsal. Continue with one restrained noir-flavored exchange about the missing master key. Leave my decision unresolved.",
          characterCount: 1,
          promptVariables: { length: CONTROLS.moderate },
        },
        {
          name: "lyrical-romance",
          prompt:
            "Continue the adult romantic scene at the rain-dark window. Keep it intimate and lyrical but concrete, with a natural opening for me to answer.",
          characterCount: 1,
          promptVariables: { styleFlavor: CONTROLS.lyrical, pacing: CONTROLS.slowBurn, length: CONTROLS.moderate },
        },
        {
          name: "dark-horror",
          prompt:
            "The power dies in the abandoned clinic and something begins moving behind the tiled wall. Continue the horror scene without softening it or deciding what I do.",
          characterCount: 1,
          promptVariables: { pacing: CONTROLS.slowBurn, length: CONTROLS.moderate },
        },
        {
          name: "dry-comedy",
          prompt:
            "A supposedly foolproof museum heist has failed because the getaway cart is an unplugged floor polisher. Continue with dry comedy and a useful new complication.",
          characterCount: 2,
          promptVariables: { length: CONTROLS.moderate },
        },
        {
          name: "spanish-roleplay",
          prompt:
            "Continúa en español: la bibliotecaria acaba de encontrar una carta fechada mañana. Escribe una escena breve y natural, y deja que yo decida si la abro.",
          characterCount: 1,
          promptVariables: { language: "Spanish", length: CONTROLS.short },
        },
        {
          name: "ensemble-scene",
          prompt:
            "Four uneasy allies meet around a broken radio after the evacuation order. Write a substantial ensemble scene where only the characters who matter speak; do not give everyone a decorative reaction.",
          characterCount: 4,
          promptVariables: { length: CONTROLS.sceneDraft },
        },
        {
          name: "strict-agency-choice",
          prompt:
            "The contract is open in front of me and the pen is beside my hand. Show the other character applying pressure, then stop before I choose, speak, sign, or move.",
          characterCount: 1,
          promptVariables: { length: CONTROLS.short },
        },
        {
          name: "explicit-adult-boundary",
          prompt:
            "Continue the consensual scene between adult characters with direct but character-specific language. Do not moralize, summarize my feelings, or choose my next action.",
          characterCount: 1,
          promptVariables: { length: CONTROLS.moderate },
        },
      ];

      const createdChatIds: string[] = [];
      const matrix: BenchmarkResult[] = [];
      try {
        for (const scenario of process.env.DE_KOI_LIVE_REPAIRS_ONLY ? [] : scenarios) {
          const chat = await createBenchmarkChat(
            usableCharacterIds.slice(0, scenario.characterCount),
            personaId,
            scenario.promptVariables,
          );
          const chatId = String(chat.id ?? "");
          expect(chatId).not.toBe("");
          createdChatIds.push(chatId);

          const counter = { value: 0 };
          const { events, rawContent } = await collectDryRun(chatId, scenario.prompt, countingLlm(counter));
          const result = resultEvent(events);
          const content = typeof result.content === "string" ? result.content : "";
          const analysis = analyzeRoleplayResponse({
            content: rawContent,
            latestUserInput: scenario.prompt,
            personaName: typeof personas[0]?.name === "string" ? personas[0].name : null,
            personaDescription: typeof personas[0]?.description === "string" ? personas[0].description : null,
            characterNames: [],
            selectedControls: scenario.promptVariables,
            agencyContract: CONTROLS.strictAgency,
          });
          expect(content.trim()).not.toBe("");
          expect(content).not.toMatch(/<\/?(?:analysis|assistant_response|roleplay_quality)\b/i);
          expect(counter.value).toBeGreaterThanOrEqual(1);
          expect(counter.value).toBeLessThanOrEqual(3);
          matrix.push({
            name: scenario.name,
            content,
            correction: result.roleplayQualityCorrection ?? null,
            modelCalls: counter.value,
            signals: analysis.signals.map((signal) => signal.kind),
            shouldAudit: analysis.shouldAudit,
          });
        }

        const injectedCases = [
          {
            name: "strict-agency",
            prompt: "The contract is open. Stop before I decide what to do.",
            candidate: 'You sign the contract and say, "I accept." The director takes the page back.',
          },
          {
            name: "malformed-unicode",
            prompt: "The hunter reaches for the latch. Continue for one beat.",
            candidate: "His hand鞭s close around the latch. The metal gives a dry click.",
          },
          {
            name: "echo-and-rhetoric",
            prompt: "The red light hums above the studio door while the director waits.",
            candidate:
              "The red light hums above the studio door while the director waits. Not because he is patient, but because he is certain. Not because the room is quiet, but because it is listening. Not because you are trapped, but because the exit is already gone.",
          },
          {
            name: "strict-agency-lean",
            prompt: "Show the room around me without deciding how I position myself.",
            candidate: "You lean your shoulder against the doorframe, arms crossed. The radio goes silent.",
          },
          {
            name: "strict-agency-grip",
            prompt: "The floor tilts. Describe the danger without choosing my response.",
            candidate: "You grip the handle to stay upright. The cart rolls toward the open shaft.",
          },
        ];
        const repairs: BenchmarkResult[] = [];
        for (const injected of injectedCases) {
          const chat = await createBenchmarkChat(usableCharacterIds.slice(0, 1), personaId, {
            length: CONTROLS.moderate,
          });
          const chatId = String(chat.id ?? "");
          expect(chatId).not.toBe("");
          createdChatIds.push(chatId);
          const counter = { value: 0 };
          const capture = { auditRaw: "" };
          const { events } = await collectDryRun(
            chatId,
            injected.prompt,
            injectedMainResponseLlm(injected.candidate, counter, capture),
          );
          const result = resultEvent(events);
          const content = typeof result.content === "string" ? result.content : "";
          expect(counter.value).toBeGreaterThanOrEqual(2);
          expect(counter.value).toBeLessThanOrEqual(3);
          expect(content.trim()).not.toBe("");
          repairs.push({
            name: injected.name,
            content,
            correction: result.roleplayQualityCorrection ?? null,
            modelCalls: counter.value,
            signals: [],
            shouldAudit: true,
            auditRaw: capture.auditRaw,
          });
        }

        console.info(
          "ROLEPLAY_QUALITY_LIVE_RESULT",
          JSON.stringify(
            {
              matrix,
              repairs,
              repairedCases: repairs.filter((result) => result.correction !== null).length,
            },
            null,
            2,
          ),
        );
        expect(repairs.filter((result) => result.correction !== null).length).toBeGreaterThanOrEqual(2);
      } finally {
        await Promise.all(createdChatIds.map((chatId) => storageApi.delete("chats", chatId).catch(() => null)));
      }
    },
    900_000,
  );
});
