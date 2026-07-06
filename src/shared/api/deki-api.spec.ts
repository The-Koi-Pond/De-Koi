import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeDekiEntryAction, type DekiEntryAction } from "../../engine/deki/deki-entry";
import { dekiApi } from "./deki-api";

const { storageApiMock } = vi.hoisted(() => ({
  storageApiMock: {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("./storage-api", () => ({
  storageApi: storageApiMock,
}));

describe("normalizeDekiEntryAction lorebook redrafts", () => {
  it("keeps a whole-lorebook redraft as one pending action", () => {
    const action = normalizeDekiEntryAction({
      type: "apply_lorebook_redraft",
      id: "lorebook-1",
      lorebook: {
        name: "Ravenloft Gazetteer",
        description: "A rewritten gothic setting guide.",
      },
      entries: [
        { id: "entry-1", name: "Castle Ravenloft", content: "A hungry silhouette above the valley." },
        { name: "Barovia", content: "Mist, hunger, and old roads." },
      ],
      label: "Apply Ravenloft redraft",
      rationale: "Turns the entry list into one reviewable lorebook update.",
    });

    expect(action).toEqual({
      type: "apply_lorebook_redraft",
      id: "lorebook-1",
      lorebook: {
        name: "Ravenloft Gazetteer",
        description: "A rewritten gothic setting guide.",
      },
      entries: [
        { id: "entry-1", name: "Castle Ravenloft", content: "A hungry silhouette above the valley." },
        { name: "Barovia", content: "Mist, hunger, and old roads." },
      ],
      label: "Apply Ravenloft redraft",
      rationale: "Turns the entry list into one reviewable lorebook update.",
    });
  });

  it("falls back to the default action when a lorebook redraft has no entries", () => {
    const action = normalizeDekiEntryAction({
      type: "apply_lorebook_redraft",
      lorebook: { name: "Empty Book" },
      entries: [],
    });

    expect(action).toMatchObject({ type: "none", capability: "read_only" });
  });
});
describe("normalizeDekiEntryAction character and persona cards", () => {
  it("keeps character edit actions that patch scenario as a direct card field", () => {
    const action = normalizeDekiEntryAction({
      type: "edit_record",
      entity: "characters",
      id: "character-rook",
      patch: {
        scenario: "Rook now guards the chapel after the midnight bargain.",
      },
      label: "Update Rook scenario",
    });

    expect(action).toEqual({
      type: "edit_record",
      entity: "characters",
      id: "character-rook",
      patch: {
        data: {
          scenario: "Rook now guards the chapel after the midnight bargain.",
        },
      },
      label: "Update Rook scenario",
    });
  });
  it("drops incomplete persona create actions", () => {
    const action = normalizeDekiEntryAction({
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
      },
    });

    expect(action).toMatchObject({ type: "none", capability: "read_only" });
  });

  it("drops persona create actions with invented card fields", () => {
    const action = normalizeDekiEntryAction({
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
        quirks: "Collects blue glass.",
      },
    });

    expect(action).toMatchObject({ type: "none", capability: "read_only" });
  });
});
describe("normalizeDekiEntryAction web research", () => {
  it("keeps a web research permission request pending until the shell grants it", () => {
    const action = normalizeDekiEntryAction({
      type: "request_web_research",
      scope: { type: "query", query: "Ghostface Dead by Daylight lore personality" },
      reason: "Compare public sources with the selected character card.",
      sources: ["official", "wiki"],
      label: "Check Ghostface sources",
    });

    expect(action).toEqual({
      type: "request_web_research",
      scope: { type: "query", query: "Ghostface Dead by Daylight lore personality" },
      reason: "Compare public sources with the selected character card.",
      sources: ["official", "wiki"],
      label: "Check Ghostface sources",
    });
  });

  it("falls back to the default action when the query scope is blank", () => {
    const action = normalizeDekiEntryAction({
      type: "request_web_research",
      scope: { type: "query", query: "   " },
      reason: "Search public sources.",
    });

    expect(action).toMatchObject({ type: "none", capability: "read_only" });
  });
});

describe("dekiApi.actions.apply", () => {
  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.delete.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.list.mockReset();
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockReset();
  });

  it("applies a whole-lorebook redraft as one action", async () => {
    const action: DekiEntryAction = {
      type: "apply_lorebook_redraft",
      id: "lorebook-1",
      lorebook: {
        name: "Ravenloft Gazetteer",
        description: "A rewritten gothic setting guide.",
      },
      entries: [
        { id: "entry-1", name: "Castle Ravenloft", content: "A hungry silhouette above the valley." },
        { name: "Barovia", content: "Mist, hunger, and old roads." },
      ],
      label: "Apply Ravenloft redraft",
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "lorebook-entries" && id === "deki-lorebook-entries-message-1-2") return null;
      return null;
    });
    storageApiMock.update.mockImplementation(async (entity: string, id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
      entity,
    }));
    storageApiMock.create.mockImplementation(async (_entity: string, draft: Record<string, unknown>) => ({
      ...draft,
      id: draft.id ?? "created-entry",
    }));

    const result = await dekiApi.actions.apply(action, { actionId: "message-1" });

    expect(storageApiMock.update).toHaveBeenCalledWith("lorebooks", "lorebook-1", {
      name: "Ravenloft Gazetteer",
      description: "A rewritten gothic setting guide.",
    });
    expect(storageApiMock.update).toHaveBeenCalledWith("lorebook-entries", "entry-1", {
      lorebookId: "lorebook-1",
      name: "Castle Ravenloft",
      content: "A hungry silhouette above the valley.",
    });
    expect(storageApiMock.create).toHaveBeenCalledWith(
      "lorebook-entries",
      expect.objectContaining({
        id: "deki-lorebook-entries-message-1-2",
        lorebookId: "lorebook-1",
        name: "Barovia",
        content: "Mist, hunger, and old roads.",
      }),
    );
    expect(result).toMatchObject({
      entity: "lorebooks",
      storageEntity: "lorebooks",
      resultId: "lorebook-1",
      result: {
        lorebook: expect.objectContaining({ id: "lorebook-1" }),
        entries: [
          expect.objectContaining({ id: "entry-1" }),
          expect.objectContaining({ id: "deki-lorebook-entries-message-1-2" }),
        ],
      },
    });
  });

  it("normalizes string lorebook scopes before applying a redraft", async () => {
    const action: DekiEntryAction = {
      type: "apply_lorebook_redraft",
      lorebook: {
        name: "The Freak Circus",
        description: "Shared surreal circus horror notes.",
        scope: "all",
      },
      entries: [{ name: "Pierrot and Harlequin", content: "A mirrored rivalry under canvas and lights." }],
      label: "Create Freak Circus lorebook",
    };
    storageApiMock.get.mockResolvedValue(null);
    storageApiMock.create.mockImplementation(async (_entity: string, draft: Record<string, unknown>) => ({
      ...draft,
      id: draft.id ?? "created-record",
    }));

    await dekiApi.actions.apply(action, { actionId: "message-freak-circus" });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "lorebooks",
      expect.objectContaining({
        name: "The Freak Circus",
        scope: { mode: "all", chatIds: [] },
      }),
    );
  });

  it("keeps draft record actions pending until the user applies them", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
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
      personality: "Bright",
      scenario: "Roadside inn",
      backstory: "Raised by caravan cooks.",
      appearance: "Sun-faded cloak and quick hands.",
    });
    expect(storageApiMock.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      entity: "personas",
      storageEntity: "personas",
      resultId: "persona-sol",
    });
  });

  it("rejects manually applied persona drafts with invented card fields", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
        quirks: "Collects blue glass.",
      },
    };

    await expect(dekiApi.actions.apply(action)).rejects.toThrow(/quirks/);
    expect(storageApiMock.create).not.toHaveBeenCalled();
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
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
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
            promptGetCount === 1 ? ["section-existing"] : ["section-existing", "deki-prompt-sections-message-1"],
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
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
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

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "deki-messages",
      expect.objectContaining({
        id: "message-1",
        sessionId: "deki-session-default",
        actionApplication: expect.objectContaining({
          status: "applied",
          resultId: "deki-personas-message-1",
        }),
      }),
    );
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({ activeSessionId: "deki-session-default" }),
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
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
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

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "deki-messages",
      expect.objectContaining({
        id: "message-1",
        sessionId: "deki-session-default",
        actionApplication: {
          status: "applied",
          appliedAt: "2026-06-24T00:00:01.000Z",
          resultId: "deki-personas-message-1",
        },
      }),
    );
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({ activeSessionId: "deki-session-default" }),
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

describe("dekiApi.actions.currentRecord", () => {
  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.delete.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.list.mockReset();
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockReset();
  });

  it("reads the current target record for edit actions", async () => {
    const action: DekiEntryAction = {
      type: "edit_record",
      entity: "lorebook-entries",
      id: "entry-1",
      patch: {
        content: "Updated entry.",
      },
    };
    storageApiMock.get.mockResolvedValue({
      id: "entry-1",
      content: "Old entry.",
    });

    const result = await dekiApi.actions.currentRecord(action);

    expect(storageApiMock.get).toHaveBeenCalledWith("lorebook-entries", "entry-1");
    expect(storageApiMock.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      entity: "lorebook-entries",
      storageEntity: "lorebook-entries",
      id: "entry-1",
      record: {
        id: "entry-1",
        content: "Old entry.",
      },
    });
  });

  it("does not read storage for create actions", async () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
        personality: "Bright",
        scenario: "Roadside inn",
        backstory: "Raised by caravan cooks.",
        appearance: "Sun-faded cloak and quick hands.",
      },
    };

    await expect(dekiApi.actions.currentRecord(action)).resolves.toBeNull();
    expect(storageApiMock.get).not.toHaveBeenCalled();
  });
});

describe("dekiApi.history session updates", () => {
  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.delete.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.list.mockReset();
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockReset();
  });

  it("updates an inactive session without taking focus from the active session", async () => {
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity !== "app-settings" || id !== "deki") return null;
      return {
        id: "deki",
        value: {
          activeSessionId: "session-current",
          sessions: [
            {
              id: "session-current",
              title: "Current chat",
              messages: [],
              compaction: {},
              createdAt: "2026-06-28T12:00:00.000Z",
              updatedAt: "2026-06-28T12:00:00.000Z",
            },
            {
              id: "session-generating",
              title: "Generating chat",
              messages: [],
              compaction: {},
              createdAt: "2026-06-28T11:00:00.000Z",
              updatedAt: "2026-06-28T11:00:00.000Z",
            },
          ],
        },
      };
    });

    await dekiApi.history.appendMessage({
      sessionId: "session-generating",
      role: "assistant",
      content: "Still working in the background.",
    });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "deki-messages",
      expect.objectContaining({
        sessionId: "session-generating",
        role: "assistant",
        content: "Still working in the background.",
      }),
    );
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({ activeSessionId: "session-current" }),
      }),
    );
  });
});
describe("dekiApi.sessions.deleteMany", () => {
  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.delete.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.list.mockReset();
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockReset();
  });

  it("deletes selected sessions in one settings rewrite while preserving the active survivor", async () => {
    storageApiMock.get.mockResolvedValue({
      id: "deki",
      value: {
        activeSessionId: "session-keep",
        sessions: [
          {
            id: "session-delete-1",
            title: "Delete one",
            messages: [],
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
          {
            id: "session-keep",
            title: "Keep me",
            messages: [],
            createdAt: "2026-06-28T11:00:00.000Z",
            updatedAt: "2026-06-28T11:00:00.000Z",
          },
          {
            id: "session-delete-2",
            title: "Delete two",
            messages: [],
            createdAt: "2026-06-28T12:00:00.000Z",
            updatedAt: "2026-06-28T12:00:00.000Z",
          },
        ],
      },
    });

    const state = await dekiApi.sessions.deleteMany(["session-delete-1", "session-delete-2"]);

    expect(state.activeSessionId).toBe("session-keep");
    expect(state.sessions.map((session) => session.id)).toEqual(["session-keep"]);
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "deki-sessions",
      "session-keep",
      expect.objectContaining({ id: "session-keep" }),
    );
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({ activeSessionId: "session-keep" }),
      }),
    );
  });

  it("creates a fresh session when every Deki session is selected", async () => {
    storageApiMock.get.mockResolvedValue({
      id: "deki",
      value: {
        activeSessionId: "session-delete",
        sessions: [
          {
            id: "session-delete",
            title: "Delete me",
            messages: [],
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      },
    });

    const state = await dekiApi.sessions.deleteMany(["session-delete"]);

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.id).not.toBe("session-delete");
    expect(state.activeSessionId).toBe(state.sessions[0]!.id);
  });
});
