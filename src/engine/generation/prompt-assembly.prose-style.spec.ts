import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { CHARACTER_WILL_NOTES } from "./character-will";
import { assembleGenerationPrompt, PROSE_STYLE_NOTE } from "./prompt-assembly";

function storage(): StorageGateway {
  const character = { id: "mira", data: { name: "Mira", description: "Mira is a careful festival guide." } };
  return new Proxy(
    {
      async get(entity: string, id: string) {
        return entity === "characters" && id === "mira" ? character : null;
      },
      async list() {
        return [];
      },
      async promptFull() {
        return null;
      },
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (typeof prop === "string" && /^(list|query)/.test(prop)) return async () => [];
        if (typeof prop === "string" && /^get/.test(prop)) return async () => null;
        return undefined;
      },
    },
  ) as unknown as StorageGateway;
}

async function assemble(mode: string, options: { trailingAssistant?: boolean; impersonate?: boolean } = {}) {
  const storedMessages = [
    { id: "u1", role: "user", content: "Tell me about the preparations." },
    { id: "a1", role: "assistant", content: "The lanterns are ready." },
    { id: "u2", role: "user", content: "What happens next?" },
    ...(options.trailingAssistant ? [{ id: "a2", role: "assistant", content: "We light them." }] : []),
  ];
  const result = await assembleGenerationPrompt(storage(), {
    chat: { id: "chat-1", mode, characterIds: ["mira"], metadata: { enableMemoryRecall: false } },
    storedMessages,
    connection: { maxContext: 32_000 },
    request: options.impersonate ? { impersonate: true } : {},
    latestUserInput: "What happens next?",
  });
  return { messages: result.messages, storedMessages };
}

function latestNonSystem(messages: Array<{ role: string; content: string }>) {
  return [...messages].reverse().find((message) => message.role !== "system")!;
}

describe("prose style note", () => {
  it.each(["roleplay", "conversation"])("ends the latest user turn in %s mode", async (mode) => {
    const { messages, storedMessages } = await assemble(mode);
    const latest = latestNonSystem(messages);

    expect(latest.role).toBe("user");
    expect(latest.content).toContain("What happens next?");
    expect(latest.content.endsWith(PROSE_STYLE_NOTE)).toBe(true);
    expect(messages.filter((message) => message.content.includes(PROSE_STYLE_NOTE))).toHaveLength(1);
    expect(storedMessages[2]!.content).toBe("What happens next?");
  });

  it("leaves game prompts alone", async () => {
    const { messages } = await assemble("game");
    expect(messages.some((message) => message.content.includes(PROSE_STYLE_NOTE))).toBe(false);
  });

  it("skips impersonation and continue turns", async () => {
    const impersonated = await assemble("roleplay", { impersonate: true });
    const continued = await assemble("roleplay", { trailingAssistant: true });

    expect(impersonated.messages.some((message) => message.content.includes(PROSE_STYLE_NOTE))).toBe(false);
    expect(continued.messages.some((message) => message.content.includes(PROSE_STYLE_NOTE))).toBe(false);
  });
});

describe("character will note", () => {
  async function latestTurn(mode: string, userText: string) {
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-1", mode, characterIds: ["mira"], metadata: { enableMemoryRecall: false } },
      storedMessages: [
        { id: "a1", role: "assistant", content: "The lanterns are ready." },
        { id: "u1", role: "user", content: userText },
      ],
      connection: { maxContext: 32_000 },
      request: {},
      latestUserInput: userText,
    });
    return { messages: result.messages, latest: latestNonSystem(result.messages) };
  }

  it.each([
    ["roleplay", "Let me carry the lantern tonight.", CHARACTER_WILL_NOTES.roleplay],
    [
      "conversation",
      "honestly you should just sell the shop, it'd be so much easier",
      CHARACTER_WILL_NOTES.conversation,
    ],
  ])("rides on the latest user turn when the user pushes in %s mode", async (mode, text, note) => {
    const { messages, latest } = await latestTurn(mode, text);

    expect(latest.content).toContain(note);
    expect(messages.filter((message) => message.content.includes(note))).toHaveLength(1);
  });

  it("stays out of an ordinary turn", async () => {
    const { messages } = await latestTurn("roleplay", "What happens next?");
    const notes = Object.values(CHARACTER_WILL_NOTES);

    expect(messages.some((message) => notes.some((note) => message.content.includes(note)))).toBe(false);
  });
});
