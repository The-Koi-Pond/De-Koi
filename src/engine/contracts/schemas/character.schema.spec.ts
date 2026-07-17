import { describe, expect, it } from "vitest";

import { createCharacterSchema, updateCharacterSchema } from "./character.schema";

const minimumCharacterData = {
  name: "Mira",
};

describe("character memory persistence schema", () => {
  it("accepts the two internal persistence values without adding them to card data", () => {
    expect(
      createCharacterSchema.parse({
        data: minimumCharacterData,
        memoryPersistence: "character",
      }),
    ).toMatchObject({
      memoryPersistence: "character",
      data: { name: "Mira" },
    });
    expect(updateCharacterSchema.parse({ memoryPersistence: "chat" })).toEqual({
      memoryPersistence: "chat",
    });
  });

  it("rejects unsupported explicit persistence values", () => {
    expect(() => updateCharacterSchema.parse({ memoryPersistence: "global" })).toThrow();
  });
});
