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

// Which runtime storage calls currently go to; null means the embedded runtime.
const runtimeTargetMock = vi.hoisted(() => ({ current: null as { baseUrl: string } | null }));

vi.mock("./remote-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-runtime")>()),
  remoteRuntimeTarget: () => runtimeTargetMock.current,
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

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "deki-messages",
      "message-1",
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

  it("hydrates only the requested durable message partition", async () => {
    const sessionRows = [
      {
        id: "session-active",
        title: "Active chat",
        compaction: {},
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:00.000Z",
      },
      {
        id: "session-requested",
        title: "Requested chat",
        compaction: {},
        createdAt: "2026-07-21T09:00:00.000Z",
        updatedAt: "2026-07-21T09:00:00.000Z",
      },
    ];
    const messageRows = {
      "session-active": [
        {
          id: "message-active",
          sessionId: "session-active",
          role: "user",
          content: "Active history.",
          createdAt: "2026-07-21T10:00:00.000Z",
          sortOrder: 0,
        },
      ],
      "session-requested": [
        {
          id: "message-requested",
          sessionId: "session-requested",
          role: "assistant",
          content: "Requested history.",
          createdAt: "2026-07-21T09:00:00.000Z",
          sortOrder: 0,
        },
      ],
    } as const;
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "app-settings" && id === "deki") {
        return { id: "deki", value: { activeSessionId: "session-active" } };
      }
      if (entity === "deki-sessions") return sessionRows.find((row) => row.id === id) ?? null;
      if (entity === "deki-messages") {
        return (
          [...messageRows["session-active"], ...messageRows["session-requested"]].find((row) => row.id === id) ?? null
        );
      }
      return null;
    });
    storageApiMock.list.mockImplementation(async (entity: string, options?: { filters?: Record<string, unknown> }) => {
      if (entity === "deki-sessions") return sessionRows;
      if (entity === "deki-messages") {
        const sessionId = options?.filters?.sessionId as keyof typeof messageRows | undefined;
        return sessionId ? [...messageRows[sessionId]] : Object.values(messageRows).flat();
      }
      return [];
    });
    const messagePartitionReads = () => storageApiMock.list.mock.calls.filter(([entity]) => entity === "deki-messages");

    const sessions = await dekiApi.sessions.list();

    expect(sessions.sessions.map((session) => session.messages)).toEqual([[], []]);
    expect(messagePartitionReads()).toHaveLength(0);

    storageApiMock.list.mockClear();
    const history = await dekiApi.history.get("session-requested");

    expect(history.messages.map((message) => message.id)).toEqual(["message-requested"]);
    expect(messagePartitionReads()).toEqual([
      [
        "deki-messages",
        {
          filters: { sessionId: "session-requested" },
          orderBy: "sortOrder",
        },
      ],
    ]);

    storageApiMock.list.mockClear();
    await dekiApi.history.appendMessage({
      role: "assistant",
      content: "Append only here.",
    });

    expect(messagePartitionReads()).toEqual([
      [
        "deki-messages",
        {
          filters: { sessionId: "session-active" },
          orderBy: "sortOrder",
        },
      ],
    ]);
  });

  it("normalizes loose durable session and message rows before returning history", async () => {
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
      if (entity === "app-settings" && id === "deki") {
        return { id: "deki", value: { activeSessionId: "missing-session" } };
      }
      return null;
    });
    storageApiMock.list.mockImplementation(async (entity: string, options?: { filters?: Record<string, unknown> }) => {
      if (entity === "deki-sessions") {
        return [
          { title: "Missing id", createdAt: "2026-06-28T09:00:00.000Z", updatedAt: "2026-06-28T09:00:00.000Z" },
          { id: "session-valid", title: "", compaction: {} },
        ];
      }
      if (entity === "deki-messages" && options?.filters?.sessionId === "session-valid") {
        return [
          { id: "message-missing-created-at", sessionId: "session-valid", role: "user", content: "No stamp." },
          {
            id: "message-action",
            sessionId: "session-valid",
            role: "assistant",
            content: "Draft ready.",
            createdAt: "2026-06-28T10:00:00.000Z",
            action,
          },
        ];
      }
      return [];
    });

    const history = await dekiApi.history.get("session-valid");

    expect(history.session).toMatchObject({
      id: "session-valid",
      title: "New Deki Chat",
      createdAt: "2026-06-28T10:00:00.000Z",
      updatedAt: "2026-06-28T10:00:00.000Z",
      messages: [
        expect.objectContaining({
          id: "message-action",
          action,
          actionApplication: null,
        }),
      ],
    });
    expect(history.messages[0]).toHaveProperty("actionApplication", null);
    expect(storageApiMock.list).toHaveBeenCalledWith("deki-messages", {
      filters: { sessionId: "session-valid" },
      orderBy: "sortOrder",
    });
  });
  it("does not patch active session settings when durable session migration fails", async () => {
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "app-settings" && id === "deki") {
        return {
          id: "deki",
          value: {
            messages: [
              {
                id: "message-1",
                role: "user",
                content: "Legacy hello.",
                createdAt: "2026-06-28T10:00:00.000Z",
              },
            ],
          },
        };
      }
      return null;
    });
    storageApiMock.create.mockImplementation(async (entity: string, draft: Record<string, unknown>) => {
      if (entity === "deki-sessions") throw new Error("session write failed");
      return draft;
    });

    await expect(dekiApi.history.appendMessage({ role: "assistant", content: "Still blocked." })).rejects.toThrow(
      "session write failed",
    );

    const settingsWrites = [...storageApiMock.create.mock.calls, ...storageApiMock.update.mock.calls].filter(
      ([entity]) => entity === "app-settings",
    );
    expect(settingsWrites).toEqual([]);
  });

  it("does not patch active session settings when durable message migration fails", async () => {
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "app-settings" && id === "deki") {
        return {
          id: "deki",
          value: {
            messages: [
              {
                id: "message-1",
                role: "user",
                content: "Legacy hello.",
                createdAt: "2026-06-28T10:00:00.000Z",
              },
            ],
          },
        };
      }
      return null;
    });
    storageApiMock.create.mockImplementation(async (entity: string, draft: Record<string, unknown>) => {
      if (entity === "deki-messages") throw new Error("message write failed");
      return draft;
    });

    await expect(dekiApi.history.appendMessage({ role: "assistant", content: "Still blocked." })).rejects.toThrow(
      "message write failed",
    );

    const settingsWrites = [...storageApiMock.create.mock.calls, ...storageApiMock.update.mock.calls].filter(
      ([entity]) => entity === "app-settings",
    );
    expect(settingsWrites).toEqual([]);
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

  it("does not rewrite unrelated Deki history when appending a message", async () => {
    const sessionRows = [
      {
        id: "session-active",
        title: "Active chat",
        compaction: {},
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:00.000Z",
      },
      {
        id: "session-unrelated",
        title: "Unrelated chat",
        compaction: {},
        createdAt: "2026-07-12T09:00:00.000Z",
        updatedAt: "2026-07-12T09:00:00.000Z",
      },
    ];
    const messageRows = {
      "session-active": [
        {
          id: "message-active",
          sessionId: "session-active",
          role: "user",
          content: "Existing active message.",
          createdAt: "2026-07-12T10:00:00.000Z",
          sortOrder: 0,
        },
      ],
      "session-unrelated": [
        {
          id: "message-unrelated",
          sessionId: "session-unrelated",
          role: "assistant",
          content: "Leave me alone.",
          createdAt: "2026-07-12T09:00:00.000Z",
          sortOrder: 0,
        },
      ],
    } as const;
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "app-settings" && id === "deki") {
        return { id: "deki", value: { activeSessionId: "session-active" } };
      }
      if (entity === "deki-sessions") return sessionRows.find((row) => row.id === id) ?? null;
      if (entity === "deki-messages") {
        return (
          [...messageRows["session-active"], ...messageRows["session-unrelated"]].find((row) => row.id === id) ?? null
        );
      }
      return null;
    });
    storageApiMock.list.mockImplementation(async (entity: string, options?: { filters?: Record<string, unknown> }) => {
      if (entity === "deki-sessions") return sessionRows;
      if (entity === "deki-messages") {
        const sessionId = options?.filters?.sessionId as keyof typeof messageRows | undefined;
        return sessionId ? [...messageRows[sessionId]] : Object.values(messageRows).flat();
      }
      return [];
    });

    await dekiApi.history.appendMessage({
      role: "assistant",
      content: "Only persist this change.",
    });

    expect(storageApiMock.list).not.toHaveBeenCalledWith("deki-messages", {
      filters: { sessionId: "session-unrelated" },
      orderBy: "sortOrder",
    });
    expect(storageApiMock.update).not.toHaveBeenCalledWith("deki-sessions", "session-unrelated", expect.anything());
    expect(storageApiMock.update).not.toHaveBeenCalledWith("deki-messages", "message-unrelated", expect.anything());
    expect(storageApiMock.create).toHaveBeenCalledWith(
      "deki-messages",
      expect.objectContaining({
        sessionId: "session-active",
        role: "assistant",
        content: "Only persist this change.",
      }),
    );
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "app-settings",
      "deki",
      expect.objectContaining({
        value: expect.objectContaining({ activeSessionId: "session-active" }),
      }),
    );
  });

  it("selects a durable session without hydrating any message partition", async () => {
    const sessionRows = [
      { id: "session-active", title: "Active", compaction: {}, createdAt: "2026-08-01", updatedAt: "2026-08-01" },
      { id: "session-next", title: "Next", compaction: {}, createdAt: "2026-08-02", updatedAt: "2026-08-02" },
    ];
    storageApiMock.get.mockResolvedValue({ id: "deki", value: { activeSessionId: "session-active" } });
    storageApiMock.list.mockImplementation(async (entity: string) => (entity === "deki-sessions" ? sessionRows : []));

    await dekiApi.sessions.select("session-next");

    expect(storageApiMock.list.mock.calls.filter(([entity]) => entity === "deki-messages")).toEqual([]);
  });

  it("updates one durable message without hydrating unrelated message partitions", async () => {
    const sessionRows = [
      { id: "session-active", title: "Active", compaction: {}, createdAt: "2026-08-01", updatedAt: "2026-08-01" },
      { id: "session-target", title: "Target", compaction: {}, createdAt: "2026-08-02", updatedAt: "2026-08-02" },
    ];
    storageApiMock.get.mockResolvedValue({ id: "deki", value: { activeSessionId: "session-active" } });
    storageApiMock.list.mockImplementation(async (entity: string, options?: { filters?: Record<string, unknown> }) => {
      if (entity === "deki-sessions") return sessionRows;
      if (entity === "deki-messages" && options?.filters?.sessionId === "session-target") {
        return [
          {
            id: "message-target",
            sessionId: "session-target",
            role: "assistant",
            content: "Before",
            createdAt: "2026-08-02",
            sortOrder: 0,
          },
        ];
      }
      return [];
    });

    await dekiApi.history.updateMessage({
      sessionId: "session-target",
      messageId: "message-target",
      content: "After",
    });

    expect(storageApiMock.list.mock.calls.filter(([entity]) => entity === "deki-messages")).toEqual([
      ["deki-messages", { filters: { sessionId: "session-target" }, orderBy: "sortOrder" }],
    ]);
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

  it("hydrates only selected durable message partitions before deletion", async () => {
    const sessionRows = [
      { id: "session-keep", title: "Keep", compaction: {}, createdAt: "2026-08-01", updatedAt: "2026-08-01" },
      { id: "session-delete", title: "Delete", compaction: {}, createdAt: "2026-08-02", updatedAt: "2026-08-02" },
    ];
    storageApiMock.get.mockResolvedValue({ id: "deki", value: { activeSessionId: "session-keep" } });
    storageApiMock.list.mockImplementation(async (entity: string, options?: { filters?: Record<string, unknown> }) => {
      if (entity === "deki-sessions") return sessionRows;
      if (entity === "deki-messages" && options?.filters?.sessionId === "session-delete") {
        return [
          {
            id: "message-delete",
            sessionId: "session-delete",
            role: "user",
            content: "Delete this history.",
            createdAt: "2026-08-02",
            sortOrder: 0,
          },
        ];
      }
      return [];
    });

    await dekiApi.sessions.deleteMany(["session-delete"]);

    expect(storageApiMock.list.mock.calls.filter(([entity]) => entity === "deki-messages")).toEqual([
      ["deki-messages", { filters: { sessionId: "session-delete" }, orderBy: "sortOrder" }],
    ]);
    expect(storageApiMock.delete).toHaveBeenCalledWith("deki-messages", "message-delete");
  });
});

describe("dekiApi.sessions first run", () => {
  type MemoryStorageOptions = {
    seed?: Record<string, Record<string, unknown>>;
    /** Return true to make that write throw when it is attempted. */
    failWrite?: (write: string) => boolean;
    onWrite?: (write: string) => void;
  };

  // Mirrors the storage owner: rows persist, and a second create of an id is rejected.
  function installMemoryStorage(options: MemoryStorageOptions = {}) {
    const rows = new Map<string, Record<string, unknown>>(Object.entries(options.seed ?? {}));
    const writes: string[] = [];
    const key = (entity: string, id: string) => `${entity}/${id}`;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const attempt = (write: string) => {
      if (options.failWrite?.(write)) throw new Error(`storage unavailable: ${write}`);
    };
    const record = (write: string) => {
      writes.push(write);
      options.onWrite?.(write);
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      await tick();
      return rows.get(key(entity, id)) ?? null;
    });
    storageApiMock.list.mockImplementation(async (entity: string) => {
      await tick();
      return [...rows.entries()].filter(([rowKey]) => rowKey.startsWith(`${entity}/`)).map(([, row]) => row);
    });
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      await tick();
      const id = String(value.id);
      attempt(`create ${entity}/${id}`);
      if (rows.has(key(entity, id))) throw new Error(`${entity}/${id} already exists`);
      rows.set(key(entity, id), value);
      record(`create ${entity}/${id}`);
      return value;
    });
    storageApiMock.update.mockImplementation(async (entity: string, id: string, value: Record<string, unknown>) => {
      await tick();
      attempt(`update ${entity}/${id}`);
      rows.set(key(entity, id), { ...rows.get(key(entity, id)), ...value, id });
      record(`update ${entity}/${id}`);
      return rows.get(key(entity, id));
    });
    storageApiMock.delete.mockImplementation(async (entity: string, id: string) => {
      await tick();
      rows.delete(key(entity, id));
      record(`delete ${entity}/${id}`);
    });
    const rowIds = (entity: string) =>
      [...rows.keys()]
        .filter((rowKey) => rowKey.startsWith(`${entity}/`))
        .map((rowKey) => rowKey.slice(entity.length + 1));
    const settings = () => (rows.get("app-settings/deki")?.value ?? {}) as Record<string, unknown>;
    return { writes, rowIds, settings };
  }

  const legacyMessage = (id: string, content: string) => ({
    id,
    role: "user",
    content,
    createdAt: "2026-06-24T00:00:00.000Z",
  });
  const legacySettingsSeed = () => ({
    "app-settings/deki": {
      id: "deki",
      value: {
        selectedConnectionId: "connection-1",
        activeSessionId: "session-two",
        sessions: [
          {
            id: "session-one",
            title: "One",
            messages: [legacyMessage("message-1", "First"), legacyMessage("message-2", "Second")],
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          {
            id: "session-two",
            title: "Two",
            messages: [legacyMessage("message-3", "Third")],
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
          },
        ],
      },
    },
  });

  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.delete.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.list.mockReset();
    storageApiMock.update.mockReset();
  });

  it("creates the default session once when several readers start together", async () => {
    installMemoryStorage();

    const states = await Promise.all([dekiApi.sessions.list(), dekiApi.sessions.list(), dekiApi.sessions.list()]);

    expect(states.map((state) => state.activeSessionId)).toEqual([
      "deki-session-default",
      "deki-session-default",
      "deki-session-default",
    ]);
    expect(storageApiMock.create.mock.calls.filter(([entity]) => entity === "deki-sessions")).toHaveLength(1);
  });

  it("holds a session created mid-migration until the migration has finished writing", async () => {
    // Start create() right after migration writes its first durable row, while
    // its message rows and settings cleanup are still pending.
    let midMigrationCreate: Promise<{ activeSessionId: string }> | null = null;
    const storage = installMemoryStorage({
      seed: legacySettingsSeed(),
      onWrite: (write) => {
        if (write === "create deki-sessions/session-one") midMigrationCreate ??= dekiApi.sessions.create();
      },
    });

    await dekiApi.sessions.list();
    expect(midMigrationCreate).not.toBeNull();
    const created = await midMigrationCreate!;

    const newSessionId = created.activeSessionId;
    expect(storage.rowIds("deki-sessions").sort()).toEqual([newSessionId, "session-one", "session-two"].sort());
    expect(storage.rowIds("deki-messages").sort()).toEqual(["message-1", "message-2", "message-3"]);
    expect(storage.settings().activeSessionId).toBe(newSessionId);
    expect(storage.settings().sessions).toBeUndefined();
    // The migration's settings cleanup lands before the new session's first write.
    expect(storage.writes.indexOf("update app-settings/deki")).toBeLessThan(
      storage.writes.indexOf(`create deki-sessions/${newSessionId}`),
    );
  });

  it("finishes a migration that failed after writing some rows", async () => {
    let failMessageWrite = true;
    const storage = installMemoryStorage({
      seed: legacySettingsSeed(),
      failWrite: (write) => failMessageWrite && write === "create deki-messages/message-2",
    });
    // A mutation queued behind the failing migration must not write anything.
    const firstRead = dekiApi.sessions.list();
    const queuedCreate = dekiApi.sessions.create();

    await expect(firstRead).rejects.toThrow("storage unavailable: create deki-messages/message-2");
    await expect(queuedCreate).rejects.toThrow("storage unavailable");
    expect(storage.rowIds("deki-sessions")).toEqual(["session-one"]);
    expect(storage.settings().sessions).toBeDefined();

    failMessageWrite = false;
    const state = await dekiApi.sessions.list();

    expect(storage.rowIds("deki-sessions").sort()).toEqual(["session-one", "session-two"]);
    expect(storage.rowIds("deki-messages").sort()).toEqual(["message-1", "message-2", "message-3"]);
    expect(state.activeSessionId).toBe("session-two");
    expect(storage.settings()).toMatchObject({ activeSessionId: "session-two", selectedConnectionId: "connection-1" });
    expect(storage.settings().sessions).toBeUndefined();
  });

  it("checks the current storage again after switching runtimes", async () => {
    installMemoryStorage();
    await dekiApi.sessions.list();

    // Another runtime or profile: one durable row from an interrupted migration,
    // with the rest of the legacy history still in settings.
    const storage = installMemoryStorage({
      seed: {
        ...legacySettingsSeed(),
        "deki-sessions/session-one": {
          id: "session-one",
          title: "One",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      },
    });
    const state = await dekiApi.sessions.list();

    expect(state.sessions.map((session) => session.id).sort()).toEqual(["session-one", "session-two"]);
    expect(storage.rowIds("deki-messages").sort()).toEqual(["message-1", "message-2", "message-3"]);
    expect(storage.settings().sessions).toBeUndefined();
    expect(storage.settings().activeSessionId).toBe("session-two");
  });

  it("keeps a migration on the runtime it started on", async () => {
    // Two runtimes with separate storage. Calls go to whichever is current when
    // they are made, like the real storage adapter after a Remote Runtime URL change.
    const runtimeA = "http://runtime-a.test";
    const runtimeB = "http://runtime-b.test";
    const stores = new Map<string, Map<string, Record<string, unknown>>>([
      [runtimeA, new Map<string, Record<string, unknown>>(Object.entries(legacySettingsSeed()))],
      [
        runtimeB,
        new Map<string, Record<string, unknown>>([
          [
            "app-settings/deki",
            {
              id: "deki",
              value: {
                activeSessionId: "session-b",
                sessions: [
                  {
                    id: "session-b",
                    title: "B",
                    messages: [legacyMessage("message-b", "On runtime B")],
                    createdAt: "2026-06-26T00:00:00.000Z",
                    updatedAt: "2026-06-26T00:00:00.000Z",
                  },
                ],
              },
            },
          ],
        ]),
      ],
    ]);
    let current = runtimeA;
    const switchTo = (runtime: string) => {
      current = runtime;
      runtimeTargetMock.current = { baseUrl: runtime };
    };
    switchTo(runtimeA);
    let switched = false;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      const rows = stores.get(current)!;
      await tick();
      return rows.get(`${entity}/${id}`) ?? null;
    });
    storageApiMock.list.mockImplementation(async (entity: string) => {
      const rows = stores.get(current)!;
      await tick();
      return [...rows.entries()].filter(([key]) => key.startsWith(`${entity}/`)).map(([, row]) => row);
    });
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      const runtime = current;
      const rows = stores.get(runtime)!;
      await tick();
      const key = `${entity}/${String(value.id)}`;
      if (rows.has(key)) throw new Error(`${key} already exists`);
      rows.set(key, value);
      // Switch runtimes right after migration writes its first durable row on A.
      if (!switched && runtime === runtimeA && key === "deki-sessions/session-one") {
        switched = true;
        switchTo(runtimeB);
      }
      return value;
    });
    storageApiMock.update.mockImplementation(async (entity: string, id: string, value: Record<string, unknown>) => {
      const rows = stores.get(current)!;
      await tick();
      rows.set(`${entity}/${id}`, { ...rows.get(`${entity}/${id}`), ...value, id });
      return rows.get(`${entity}/${id}`);
    });
    storageApiMock.delete.mockImplementation(async (entity: string, id: string) => {
      const rows = stores.get(current)!;
      await tick();
      rows.delete(`${entity}/${id}`);
    });
    const ids = (runtime: string, entity: string) =>
      [...stores.get(runtime)!.keys()]
        .filter((key) => key.startsWith(`${entity}/`))
        .map((key) => key.slice(entity.length + 1))
        .sort();
    const settings = (runtime: string) =>
      (stores.get(runtime)!.get("app-settings/deki")?.value ?? {}) as Record<string, unknown>;

    try {
      const state = await dekiApi.sessions.list();

      // The read ends on runtime B with only B's history.
      expect(state.sessions.map((session) => session.id)).toEqual(["session-b"]);
      expect(ids(runtimeB, "deki-sessions")).toEqual(["session-b"]);
      expect(ids(runtimeB, "deki-messages")).toEqual(["message-b"]);
      expect(settings(runtimeB).sessions).toBeUndefined();
      // A's migration stopped at the switch: nothing of A reached B, and A
      // keeps its legacy history for its own next read.
      expect(ids(runtimeA, "deki-sessions")).toEqual(["session-one"]);
      expect(ids(runtimeA, "deki-messages")).toEqual([]);
      expect(settings(runtimeA).sessions).toBeDefined();

      switchTo(runtimeA);
      const back = await dekiApi.sessions.list();

      expect(back.sessions.map((session) => session.id).sort()).toEqual(["session-one", "session-two"]);
      expect(ids(runtimeA, "deki-messages")).toEqual(["message-1", "message-2", "message-3"]);
      expect(settings(runtimeA).sessions).toBeUndefined();
      expect(ids(runtimeB, "deki-sessions")).toEqual(["session-b"]);
    } finally {
      runtimeTargetMock.current = null;
    }
  });

  it("never returns history mixed from two runtimes", async () => {
    // Two runtimes whose history is already durable. A runtime switch is
    // triggered inside one storage read, after that read picked its runtime.
    const runtimeA = "http://runtime-a.test";
    const runtimeB = "http://runtime-b.test";
    // Both runtimes hold the same session id with different content, so only
    // the content shows which runtime a result came from.
    const durable = (session: string, title: string, message: string, content: string, messageCount: number) =>
      new Map<string, Record<string, unknown>>([
        ["app-settings/deki", { id: "deki", value: { activeSessionId: session } }],
        [
          `deki-sessions/${session}`,
          {
            id: session,
            title,
            messageCount,
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
        ],
        [
          `deki-messages/${message}`,
          {
            id: message,
            sessionId: session,
            role: "user",
            content,
            createdAt: "2026-06-24T00:00:00.000Z",
            sortOrder: 0,
          },
        ],
      ]);
    const stores = new Map([
      [runtimeA, durable("session-shared", "Title A", "message-a", "On runtime A", 7)],
      [runtimeB, durable("session-shared", "Title B", "message-b", "On runtime B", 1)],
    ]);
    let current = runtimeA;
    let switchDuringList: string | null = null;
    const switchRuntime = (runtime: string) => {
      current = runtime;
      runtimeTargetMock.current = { baseUrl: runtime };
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      const rows = stores.get(current)!;
      await tick();
      return rows.get(`${entity}/${id}`) ?? null;
    });
    storageApiMock.list.mockImplementation(async (entity: string, options?: { filters?: Record<string, unknown> }) => {
      const rows = stores.get(current)!;
      await tick();
      const found = [...rows.entries()]
        .filter(([key]) => key.startsWith(`${entity}/`))
        .map(([, row]) => row)
        .filter((row) => !options?.filters?.sessionId || row.sessionId === options.filters.sessionId);
      if (switchDuringList === entity) {
        switchDuringList = null;
        switchRuntime(runtimeB);
      }
      return found;
    });

    try {
      // A switch while history.get loads messages.
      switchRuntime(runtimeA);
      switchDuringList = "deki-messages";
      const history = await dekiApi.history.get("session-shared");
      expect(history.session.id).toBe("session-shared");
      expect(history.session.title).toBe("Title B");
      expect(history.messages.map((message) => [message.id, message.content])).toEqual([["message-b", "On runtime B"]]);

      // A switch while history.get lists sessions, before it hydrates messages.
      switchRuntime(runtimeA);
      switchDuringList = "deki-sessions";
      const hydrated = await dekiApi.history.get("session-shared");
      expect(hydrated.session.title).toBe("Title B");
      expect(hydrated.messages.map((message) => [message.id, message.content])).toEqual([
        ["message-b", "On runtime B"],
      ]);

      // A switch while sessions.list loads summaries: the title and message
      // count come from runtime B, and no messages are hydrated.
      switchRuntime(runtimeA);
      switchDuringList = "deki-sessions";
      const listed = await dekiApi.sessions.list();
      expect(
        listed.sessions.map((session) => [session.id, session.title, session.messageCount, session.messages.length]),
      ).toEqual([["session-shared", "Title B", 1, 0]]);
      expect(listed.activeSessionId).toBe("session-shared");

      // A session that is not the active one: both runtimes gain "session-other",
      // and the switch lands while its messages load.
      for (const [runtime, suffix] of [
        [runtimeA, "A"],
        [runtimeB, "B"],
      ] as const) {
        const rows = stores.get(runtime)!;
        rows.set("deki-sessions/session-other", {
          id: "session-other",
          title: `Other ${suffix}`,
          messageCount: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        });
        rows.set(`deki-messages/other-${suffix}`, {
          id: `other-${suffix}`,
          sessionId: "session-other",
          role: "user",
          content: `Other on runtime ${suffix}`,
          createdAt: "2026-06-23T00:00:00.000Z",
          sortOrder: 0,
        });
      }
      switchRuntime(runtimeA);
      switchDuringList = "deki-messages";
      const other = await dekiApi.history.get("session-other");
      expect(other.session.id).toBe("session-other");
      expect(other.session.title).toBe("Other B");
      expect(other.messages.map((message) => [message.id, message.content])).toEqual([
        ["other-B", "Other on runtime B"],
      ]);
    } finally {
      runtimeTargetMock.current = null;
    }
  });

  it("falls back to the active session when the requested one does not exist", async () => {
    installMemoryStorage({ seed: legacySettingsSeed() });

    const history = await dekiApi.history.get("session-missing");

    expect(history.session.id).toBe("session-two");
    expect(history.messages.map((message) => message.id)).toEqual(["message-3"]);
  });

  it("finishes a migration whose settings cleanup failed", async () => {
    let failCleanup = true;
    const storage = installMemoryStorage({
      seed: legacySettingsSeed(),
      failWrite: (write) => failCleanup && write === "update app-settings/deki",
    });

    await expect(dekiApi.sessions.list()).rejects.toThrow("storage unavailable: update app-settings/deki");
    expect(storage.rowIds("deki-messages").sort()).toEqual(["message-1", "message-2", "message-3"]);
    expect(storage.settings().sessions).toBeDefined();

    failCleanup = false;
    const state = await dekiApi.sessions.list();

    expect(state.activeSessionId).toBe("session-two");
    expect(state.sessions.map((session) => session.id).sort()).toEqual(["session-one", "session-two"]);
    expect(storage.settings().sessions).toBeUndefined();
    expect(storage.settings().activeSessionId).toBe("session-two");
  });
});
