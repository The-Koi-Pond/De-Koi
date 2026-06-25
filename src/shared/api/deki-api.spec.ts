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
    let promptGetCount = 0;
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "prompt-sections" && id === "deki-prompt-sections-message-1") return null;
      if (entity === "prompts" && id === "preset-1") {
        promptGetCount += 1;
        return {
          id: "preset-1",
          sectionOrder: promptGetCount === 1 ? ["section-existing"] : ["section-existing", "section-new"],
        };
      }
      return null;
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
    storageApiMock.get.mockResolvedValue({
      id: "deki-personas-message-1",
      name: "Sol",
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1" });

    expect(storageApiMock.create).not.toHaveBeenCalled();
    expect(storageApiMock.get).toHaveBeenCalledWith("personas", "deki-personas-message-1");
    expect(storageApiMock.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      resultId: "deki-personas-message-1",
    });
  });

  it("reconciles prompt child order when retry finds an existing deterministic child", async () => {
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
    let promptGetCount = 0;
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "prompt-sections" && id === "deki-prompt-sections-message-1") {
        return {
          id: "deki-prompt-sections-message-1",
          presetId: "preset-1",
          name: "Deki Section",
        };
      }
      if (entity === "prompts" && id === "preset-1") {
        promptGetCount += 1;
        return {
          id: "preset-1",
          sectionOrder:
            promptGetCount === 1
              ? ["section-existing"]
              : ["section-existing", "deki-prompt-sections-message-1"],
        };
      }
      return null;
    });
    storageApiMock.update.mockResolvedValue({
      id: "preset-1",
      sectionOrder: ["section-existing", "deki-prompt-sections-message-1"],
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1" });

    expect(storageApiMock.create).not.toHaveBeenCalled();
    expect(storageApiMock.get).toHaveBeenCalledWith("prompt-sections", "deki-prompt-sections-message-1");
    expect(storageApiMock.get).toHaveBeenCalledWith("prompts", "preset-1");
    expect(storageApiMock.update).toHaveBeenCalledWith("prompts", "preset-1", {
      sectionOrder: ["section-existing", "deki-prompt-sections-message-1"],
    });
    expect(result).toMatchObject({
      resultId: "deki-prompt-sections-message-1",
    });
  });

  it("returns one reconciled result after applying and marking the action message", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "personas" && id === "deki-personas-message-1") return null;
      if (entity === "app-settings" && id === "deki") {
        return {
          id: "deki",
          value: {
            messages: [
              {
                id: "message-1",
                role: "assistant",
                content: "Draft ready.",
                createdAt: "2026-06-24T00:00:00.000Z",
                action,
              },
            ],
          },
        };
      }
      return null;
    });
    storageApiMock.create.mockResolvedValue({
      id: "deki-personas-message-1",
      name: "Sol",
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1", messageId: "message-1" });

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({
          activeSessionId: "deki-session-default",
          sessions: [
            expect.objectContaining({
              id: "deki-session-default",
              messages: [
                expect.objectContaining({
                  id: "message-1",
                  actionApplication: expect.objectContaining({
                    status: "applied",
                    resultId: "deki-personas-message-1",
                  }),
                }),
              ],
            }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({
      resultId: "deki-personas-message-1",
      application: {
        status: "applied",
        resultId: "deki-personas-message-1",
      },
      messages: [
        expect.objectContaining({
          id: "message-1",
          actionApplication: expect.objectContaining({
            status: "applied",
            resultId: "deki-personas-message-1",
          }),
        }),
      ],
    });
  });

  it("rewrites settings when the action message already has an applied marker", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "personas" && id === "deki-personas-message-1") return null;
      if (entity === "app-settings" && id === "deki") {
        return {
          id: "deki",
          value: {
            messages: [
              {
                id: "message-1",
                role: "assistant",
                content: "Draft ready.",
                createdAt: "2026-06-24T00:00:00.000Z",
                action,
                actionApplication: {
                  status: "applied",
                  appliedAt: "2026-06-24T00:00:01.000Z",
                  resultId: "deki-personas-message-1",
                },
              },
            ],
          },
        };
      }
      return null;
    });
    storageApiMock.create.mockResolvedValue({
      id: "deki-personas-message-1",
      name: "Sol",
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1", messageId: "message-1" });

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({
          activeSessionId: "deki-session-default",
          sessions: [
            expect.objectContaining({
              id: "deki-session-default",
              messages: [
                expect.objectContaining({
                  id: "message-1",
                  actionApplication: {
                    status: "applied",
                    appliedAt: "2026-06-24T00:00:01.000Z",
                    resultId: "deki-personas-message-1",
                  },
                }),
              ],
            }),
          ],
        }),
      }),
    );
    expect(result.application).toEqual({
      status: "applied",
      appliedAt: "2026-06-24T00:00:01.000Z",
      resultId: "deki-personas-message-1",
    });
  });

  it("retries prompt child order reconciliation when the first verification misses the child", async () => {
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
    let promptGetCount = 0;
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "prompt-sections" && id === "deki-prompt-sections-message-1") return null;
      if (entity === "prompts" && id === "preset-1") {
        promptGetCount += 1;
        if (promptGetCount === 1) {
          return {
            id: "preset-1",
            sectionOrder: ["section-existing"],
          };
        }
        if (promptGetCount === 2 || promptGetCount === 3) {
          return {
            id: "preset-1",
            sectionOrder: ["section-existing", "section-other"],
          };
        }
        return {
          id: "preset-1",
          sectionOrder: ["section-existing", "section-other", "section-new"],
        };
      }
      return null;
    });
    storageApiMock.create.mockResolvedValue({
      id: "section-new",
      presetId: "preset-1",
      name: "Deki Section",
    });

    const result = await dekiApi.actions.apply(action, { actionId: "message-1" });

    expect(storageApiMock.update).toHaveBeenCalledTimes(2);
    expect(storageApiMock.update).toHaveBeenLastCalledWith("prompts", "preset-1", {
      sectionOrder: ["section-existing", "section-other", "section-new"],
    });
    expect(result).toMatchObject({
      resultId: "section-new",
    });
  });
});
