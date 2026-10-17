import { describe, expect, it } from "vitest";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt, authorNotesDepthEntry } from "./prompt-assembly";

const turns = (count: number) =>
  Array.from({ length: count * 2 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: "x" }));

describe("Author's Notes placement", () => {
  it("inserts every message by default, as a system note at depth 4", () => {
    const chat = { metadata: { authorNotes: "Keep it rainy." } };

    expect(authorNotesDepthEntry(chat, turns(1))).toEqual({ content: "Keep it rainy.", role: "system", depth: 4 });
    expect(authorNotesDepthEntry(chat, turns(2))).not.toBeNull();
  });

  it("inserts only every Nth user message, and never at 0", () => {
    const every3 = { metadata: { authorNotes: "Rain.", authorNotesInterval: 3, authorNotesRole: "user" } };
    const off = { metadata: { authorNotes: "Rain.", authorNotesInterval: 0 } };

    expect([1, 2, 3, 4, 5, 6].map((count) => authorNotesDepthEntry(every3, turns(count)) !== null)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(authorNotesDepthEntry(every3, turns(3))?.role).toBe("user");
    expect(authorNotesDepthEntry(off, turns(1))).toBeNull();
  });
});

describe("Author's Notes role through prompt assembly", () => {
  function storage(strictRoleFormatting: boolean): StorageGateway {
    const preset = { id: "preset-1", name: "Preset", wrapFormat: "xml", parameters: { strictRoleFormatting } };
    return {
      async list<T>(entity: StorageEntity): Promise<T[]> {
        return (entity === "prompts" ? [preset] : []) as T[];
      },
      async get<T>(entity: StorageEntity, id: string): Promise<T | null> {
        if (entity === "characters") return { id, name: "Mira", description: "A ranger.", tags: [] } as T;
        if (entity === "prompts") return preset as T;
        return null;
      },
    } as unknown as StorageGateway;
  }

  it("keeps the chosen role at every depth, with or without strict role formatting", async () => {
    for (const strictRoleFormatting of [false, true]) {
      for (const depth of [0, 1, 3]) {
        for (const role of ["system", "user", "assistant"] as const) {
          const prompt = await assembleGenerationPrompt(storage(strictRoleFormatting), {
            chat: {
              id: "chat-1",
              mode: "roleplay",
              characterIds: ["char-1"],
              metadata: { authorNotes: "NOTE-MARK", authorNotesDepth: depth, authorNotesRole: role },
            },
            storedMessages: [
              { role: "user", content: "u1" },
              { role: "assistant", content: "a1" },
              { role: "user", content: "u2" },
              { role: "assistant", content: "a2" },
              { role: "user", content: "u3" },
            ],
            connection: { provider: "openai", model: "qa-model" },
            request: { promptPresetId: "preset-1" },
            latestUserInput: "u3",
          });
          const note = prompt.messages.find((message) => message.content.includes("NOTE-MARK"));
          expect(note?.role, `strict=${strictRoleFormatting} depth=${depth} role=${role}`).toBe(role);
        }
      }
    }
  });
});
