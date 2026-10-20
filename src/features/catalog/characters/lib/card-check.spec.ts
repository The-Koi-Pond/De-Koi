import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../shared/api/storage-api";
import { runCardCheck } from "./card-check";

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { list: vi.fn() },
}));

const list = vi.mocked(storageApi.list);

const clean = { id: "clean", data: { name: "Ada", first_mes: "*Ada looks up.* Hello." } };
const labelled = { id: "labelled", data: { name: "Bo", first_mes: "{{char}}: *Bo waves.* Hi there." } };

describe("runCardCheck", () => {
  beforeEach(() => list.mockReset());

  it("checks every saved card and returns only the flagged ones", async () => {
    list.mockResolvedValue([clean, labelled, { id: "broken-row", data: null }]);

    const result = await runCardCheck();

    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([{ characterId: "labelled", name: "Bo", data: labelled.data }]);
    const [entity, options] = list.mock.calls[0]!;
    expect(entity).toBe("characters");
    expect(options).toMatchObject({ fields: ["id", "data"] });
    expect(options).not.toHaveProperty("whereIn");
    // Only the text the linter reads, not avatars, lorebooks or extensions.
    expect(options?.fieldSelections?.data).toEqual(expect.arrayContaining(["first_mes", "alternate_greetings"]));
    expect(options?.fieldSelections?.data).not.toContain("character_book");
  });

  it("checks only the given cards", async () => {
    list.mockResolvedValue([labelled]);

    const result = await runCardCheck(["labelled"]);

    expect(result.flagged.map((target) => target.characterId)).toEqual(["labelled"]);
    expect(list.mock.calls[0]![1]).toMatchObject({ whereIn: { field: "id", values: ["labelled"] } });
  });

  it("does not read storage for an empty id list", async () => {
    await expect(runCardCheck([])).resolves.toEqual({ checked: 0, flagged: [] });
    expect(list).not.toHaveBeenCalled();
  });
});
