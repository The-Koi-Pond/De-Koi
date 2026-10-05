import { describe, expect, it } from "vitest";
import type { StorageGateway } from "../capabilities/storage";
import { loadCharacters } from "./prompt-assembly";
import type { JsonRecord } from "./runtime-records";

function storageWith(character: JsonRecord): StorageGateway {
  return {
    get: async (_entity: string, id: string) => (id === character.id ? character : null),
  } as unknown as StorageGateway;
}

const chat: JsonRecord = { id: "chat-1", mode: "conversation", characterIds: ["char-1"], metadata: {} };

describe("loadCharacters backstory and appearance", () => {
  it("prefers the editor's extension fields over stale top-level copies", async () => {
    const storage = storageWith({
      id: "char-1",
      data: {
        name: "Pierrot",
        backstory: "Old imported backstory.",
        appearance: "Old imported costume-only appearance.",
        extensions: { backstory: "Edited backstory.", appearance: "Edited appearance with monster form." },
      },
    });

    const [character] = await loadCharacters(storage, chat);

    expect(character?.backstory).toBe("Edited backstory.");
    expect(character?.appearance).toBe("Edited appearance with monster form.");
  });

  it("falls back to top-level fields when the extensions are empty", async () => {
    const storage = storageWith({
      id: "char-1",
      data: {
        name: "Mira",
        backstory: "Imported backstory.",
        appearance: "Silver coat.",
        extensions: { appearance: "  " },
      },
    });

    const [character] = await loadCharacters(storage, chat);

    expect(character?.backstory).toBe("Imported backstory.");
    expect(character?.appearance).toBe("Silver coat.");
  });
});
