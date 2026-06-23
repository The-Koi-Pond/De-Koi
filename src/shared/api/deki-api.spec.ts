import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DekiEntryAction } from "../../engine/deki/deki-entry";
import { dekiApi } from "./deki-api";

const { storageApiMock } = vi.hoisted(() => ({
  storageApiMock: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("./storage-api", () => ({
  storageApi: storageApiMock,
}));

describe("dekiApi.actions.apply", () => {
  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.update.mockReset();
  });

  it("keeps draft record actions pending until the user applies them", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
      },
      label: "Create Sol",
    };

    expect(storageApiMock.create).not.toHaveBeenCalled();
    storageApiMock.create.mockResolvedValue({ id: "persona-sol", name: "Sol" });

    const result = await dekiApi.actions.apply(action);

    expect(storageApiMock.create).toHaveBeenCalledTimes(1);
    expect(storageApiMock.create).toHaveBeenCalledWith("personas", {
      name: "Sol",
      description: "Sunny traveler",
    });
    expect(storageApiMock.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      entity: "personas",
      storageEntity: "personas",
      resultId: "persona-sol",
    });
  });

  it("appends Deki-created prompt sections to the parent preset order", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "prompt-sections",
      draft: {
        presetId: "preset-1",
        identifier: "section_deki",
        name: "Deki Section",
        content: "Use a lighter tone.",
      },
    };
    storageApiMock.create.mockResolvedValue({
      id: "section-new",
      presetId: "preset-1",
      name: "Deki Section",
    });
    storageApiMock.get.mockResolvedValue({
      id: "preset-1",
      sectionOrder: ["section-existing"],
    });
    storageApiMock.update.mockResolvedValue({
      id: "preset-1",
      sectionOrder: ["section-existing", "section-new"],
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1" });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "prompt-sections",
      expect.objectContaining({
        id: "deki-prompt-sections-message-1",
        presetId: "preset-1",
        identifier: "section_deki",
        name: "Deki Section",
      }),
    );
    expect(storageApiMock.get).toHaveBeenCalledWith("prompts", "preset-1");
    expect(storageApiMock.update).toHaveBeenCalledWith("prompts", "preset-1", {
      sectionOrder: ["section-existing", "section-new"],
    });
    expect(result).toMatchObject({
      entity: "prompt-sections",
      storageEntity: "prompt-sections",
      resultId: "section-new",
    });
  });

  it("reuses an existing deterministic create record when a retry follows a saved write", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
      },
    };
    storageApiMock.create.mockRejectedValue(new Error("Record already exists"));
    storageApiMock.get.mockResolvedValue({
      id: "deki-personas-message-1",
      name: "Sol",
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1" });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "personas",
      expect.objectContaining({
        id: "deki-personas-message-1",
        name: "Sol",
      }),
    );
    expect(storageApiMock.get).toHaveBeenCalledWith("personas", "deki-personas-message-1");
    expect(storageApiMock.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      resultId: "deki-personas-message-1",
    });
  });
});
