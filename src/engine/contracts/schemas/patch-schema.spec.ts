import { describe, expect, it } from "vitest";
import { z } from "zod";

import { updateCharacterSchema } from "./character.schema";
import { deepPatchSchema, patchSchema } from "./patch-schema";

const item = z.object({
  name: z.string(),
  description: z.string().default(""),
  tags: z.array(z.string()).prefault([]),
  depth: z.object({ value: z.number().default(4) }).prefault({}),
});

describe("patchSchema", () => {
  it("leaves fields the update didn't send out of the result", () => {
    expect(patchSchema(item).parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });

  it("still checks the fields that were sent", () => {
    expect(patchSchema(item).safeParse({ tags: "not a list" }).success).toBe(false);
  });

  it("keeps passthrough objects passing unknown keys through", () => {
    expect(patchSchema(item.passthrough()).parse({ extra: 1 })).toEqual({ extra: 1 });
  });
});

describe("deepPatchSchema", () => {
  it("makes nested objects partial without filling their defaults", () => {
    const schema = deepPatchSchema(z.object({ profile: item }));
    expect(schema.parse({ profile: { name: "x" } })).toEqual({ profile: { name: "x" } });
    expect(schema.parse({})).toEqual({});
  });
});

describe("updateCharacterSchema", () => {
  it("sends only the changed character fields", () => {
    expect(updateCharacterSchema.parse({ data: { name: "Renamed" } })).toEqual({ data: { name: "Renamed" } });
  });
});
