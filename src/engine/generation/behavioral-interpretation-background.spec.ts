import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type { Character, CharacterData } from "../contracts/types/character";
import {
  deriveCharacterBehavioralInterpretation,
  scheduleSparseCharacterInterpretations,
} from "./behavioral-interpretation-background";
import { behavioralInterpretationSourceHash } from "./behavioral-interpretation";

function characterData(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name: "Mira",
    description: "A guarded courier who avoids direct answers about the missing letter.",
    personality: "Uses dry jokes to deflect personal questions.",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: [],
    creator: "",
    character_version: "",
    alternate_greetings: [],
    extensions: {
      talkativeness: 0.5,
      fav: false,
      world: "",
      depth_prompt: { prompt: "", depth: 4, role: "system" },
      backstory: "",
      appearance: "",
    },
    character_book: null,
    ...overrides,
  };
}

function character(data = characterData()): Character {
  return {
    id: "mira",
    data,
    comment: "",
    avatarPath: null,
    spriteFolderPath: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function llmReturning(value: unknown, requests: LlmRequest[] = []): LlmGateway {
  return {
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      return JSON.stringify(value);
    }),
    stream: vi.fn(),
    listModels: vi.fn(),
  } as unknown as LlmGateway;
}

function storageFor(row: Character) {
  let current = structuredClone(row);
  const storage = {
    get: vi.fn(async (_entity: string, id: string) => (id === current.id ? structuredClone(current) : null)),
    update: vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      current = { ...current, ...patch } as Character;
      return structuredClone(current);
    }),
  } as unknown as StorageGateway;
  return { storage, current: () => current };
}

describe("sparse character behavioral interpretation background", () => {
  it("derives only evidence-backed claims through the selected connection", async () => {
    const requests: LlmRequest[] = [];
    const result = await deriveCharacterBehavioralInterpretation(
      {
        llm: llmReturning(
          {
            claims: [
              {
                statement: "Mira may deflect personal questions with dry humor.",
                evidenceClass: "strongly_implied",
                evidence: [{ field: "personality", quote: "Uses dry jokes to deflect personal questions." }],
              },
            ],
          },
          requests,
        ),
      },
      { character: characterData(), connectionId: "connection-1" },
    );

    expect(result?.claims).toHaveLength(1);
    expect(result?.claims[0]).toMatchObject({ evidenceClass: "strongly_implied", source: "generated" });
    expect(requests[0]).toMatchObject({ connectionId: "connection-1" });
    expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain(
      "Uses dry jokes to deflect personal questions.",
    );
  });

  it("returns before model work and saves the derived profile later", async () => {
    const row = character();
    const { storage, current } = storageFor(row);
    const llm = llmReturning({
      claims: [
        {
          statement: "Mira may resist direct questions about the letter.",
          evidenceClass: "tentative",
          evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
        },
      ],
    });

    scheduleSparseCharacterInterpretations({ storage, llm }, { characterIds: ["mira"], connectionId: "connection-1" });

    expect(llm.complete).not.toHaveBeenCalled();
    expect(storage.update).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(current().behavioralInterpretation?.status).toBe("ready"));
  });

  it("reports background failures that happen before a profile can be saved", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = {
      get: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    } as unknown as StorageGateway;

    try {
      scheduleSparseCharacterInterpretations(
        { storage, llm: llmReturning({ claims: [] }) },
        { characterIds: ["mira"], connectionId: "connection-1" },
      );

      await vi.waitFor(() =>
        expect(warning).toHaveBeenCalledWith("[generation] behavioral interpretation background item failed", {
          characterId: "mira",
          error: "storage unavailable",
        }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("skips rich cards and a failed same-version profile until the card changes or the user requests regeneration", async () => {
    const rich = characterData({
      description: "A veteran courier with a detailed professional code. ".repeat(20),
      personality: "Guarded but compassionate, with precise habits and firm boundaries. ".repeat(12),
      scenario: "A tense negotiation in a crowded city depot. ".repeat(12),
      first_mes: "She checks every exit, then offers a careful greeting. ".repeat(12),
      mes_example: "{{char}}: I can answer that, but first tell me why it matters. ".repeat(12),
    });
    const { storage } = storageFor(character(rich));
    const llm = llmReturning({ claims: [] });

    scheduleSparseCharacterInterpretations({ storage, llm }, { characterIds: ["mira"], connectionId: "connection-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llm.complete).not.toHaveBeenCalled();

    const failedRow = character();
    failedRow.behavioralInterpretation = {
      version: 1,
      sourceHash: behavioralInterpretationSourceHash(failedRow.data),
      status: "failed",
      enabled: true,
      claims: [],
      lastError: "No valid evidence-backed claims were returned.",
    };
    const failedStorage = storageFor(failedRow);
    scheduleSparseCharacterInterpretations(
      { storage: failedStorage.storage, llm },
      { characterIds: ["mira"], connectionId: "connection-1" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("keeps disabled profiles quiet and preserves user corrections across regeneration", async () => {
    const disabledRow = character();
    disabledRow.behavioralInterpretation = {
      version: 1,
      sourceHash: behavioralInterpretationSourceHash(disabledRow.data),
      status: "ready",
      enabled: false,
      regenerationRequested: true,
      claims: [],
    };
    const disabledState = storageFor(disabledRow);
    const llm = llmReturning({
      claims: [
        {
          statement: "Mira may resist direct questions about the letter.",
          evidenceClass: "tentative",
          evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
        },
      ],
    });
    scheduleSparseCharacterInterpretations(
      { storage: disabledState.storage, llm },
      { characterIds: ["mira"], connectionId: "connection-1" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(llm.complete).not.toHaveBeenCalled();

    const pendingRow = character();
    pendingRow.behavioralInterpretation = {
      version: 1,
      sourceHash: behavioralInterpretationSourceHash(pendingRow.data),
      status: "ready",
      enabled: true,
      regenerationRequested: true,
      claims: [
        {
          id: "user-1",
          statement: "Mira answers directly once trust is earned.",
          evidenceClass: "explicit",
          evidence: [{ field: "user_override", quote: "User correction" }],
          source: "user_override",
        },
      ],
    };
    const pendingState = storageFor(pendingRow);
    scheduleSparseCharacterInterpretations(
      { storage: pendingState.storage, llm },
      { characterIds: ["mira"], connectionId: "connection-1" },
    );
    await vi.waitFor(() => expect(pendingState.current().behavioralInterpretation?.status).toBe("ready"));
    expect(pendingState.current().behavioralInterpretation?.claims).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "user-1", source: "user_override" })]),
    );
  });

  it("keeps a current profile active when requested regeneration fails", async () => {
    const row = character();
    row.behavioralInterpretation = {
      version: 1,
      sourceHash: behavioralInterpretationSourceHash(row.data),
      status: "ready",
      enabled: true,
      regenerationRequested: true,
      claims: [
        {
          id: "existing",
          statement: "Mira may deflect personal questions with dry humor.",
          evidenceClass: "strongly_implied",
          evidence: [{ field: "personality", quote: "Uses dry jokes to deflect personal questions." }],
          source: "generated",
        },
      ],
    };
    const state = storageFor(row);
    const llm = llmReturning({ claims: [] });

    scheduleSparseCharacterInterpretations(
      { storage: state.storage, llm },
      { characterIds: ["mira"], connectionId: "connection-1" },
    );

    await vi.waitFor(() => expect(state.current().behavioralInterpretation?.regenerationRequested).toBe(false));
    expect(state.current().behavioralInterpretation).toMatchObject({
      status: "ready",
      claims: [expect.objectContaining({ id: "existing" })],
      lastError: "The model did not return a valid evidence-backed behavioral interpretation.",
    });
  });

  it("does not overwrite edits made while derivation is running", async () => {
    let finish: ((value: string) => void) | undefined;
    const llm = {
      complete: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
      stream: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LlmGateway;
    const row = character();
    const state = storageFor(row);

    scheduleSparseCharacterInterpretations(
      { storage: state.storage, llm },
      { characterIds: ["mira"], connectionId: "connection-1" },
    );
    await vi.waitFor(() => expect(llm.complete).toHaveBeenCalledOnce());
    await state.storage.update("characters", "mira", {
      data: characterData({ personality: "Now openly answers personal questions." }),
    });
    finish?.(
      JSON.stringify({
        claims: [
          {
            statement: "Mira may resist direct questions about the letter.",
            evidenceClass: "tentative",
            evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
          },
        ],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.current().behavioralInterpretation).toBeUndefined();
  });

  it("does not overwrite a disable made while derivation is running", async () => {
    let finish: ((value: string) => void) | undefined;
    const llm = {
      complete: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
      stream: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LlmGateway;
    const state = storageFor(character());
    scheduleSparseCharacterInterpretations(
      { storage: state.storage, llm },
      { characterIds: ["mira"], connectionId: "connection-1" },
    );
    await vi.waitFor(() => expect(llm.complete).toHaveBeenCalledOnce());
    await state.storage.update("characters", "mira", {
      behavioralInterpretation: {
        version: 1,
        sourceHash: behavioralInterpretationSourceHash(state.current().data),
        status: "ready",
        enabled: false,
        claims: [],
      },
    });
    finish?.(
      JSON.stringify({
        claims: [
          {
            statement: "Mira may resist direct questions about the letter.",
            evidenceClass: "tentative",
            evidence: [{ field: "description", quote: "avoids direct answers about the missing letter" }],
          },
        ],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.current().behavioralInterpretation?.enabled).toBe(false);
  });
});
