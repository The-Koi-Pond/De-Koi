import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { ApiError } from "../../../../shared/api/api-errors";
import { chatKeys } from "../query-keys";
import { useDeleteChat, useDeleteChats } from "./use-chat-lifecycle";

// Hooks import useMutation through the app wrapper; route it to the mocked TanStack hook.
vi.mock("../../../../shared/hooks/use-mutation", async () => ({
  useMutation: (await import("@tanstack/react-query")).useMutation,
}));

const reactQueryMocks = vi.hoisted(() => ({
  currentQueryClient: null as QueryClient | null,
  useMutation: vi.fn((options) => options),
}));

vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: reactQueryMocks.useMutation,
    useQueryClient: () => {
      if (!reactQueryMocks.currentQueryClient) throw new Error("Missing QueryClient for test.");
      return reactQueryMocks.currentQueryClient;
    },
  };
});

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { create: vi.fn(), delete: vi.fn(), patchChatMetadata: vi.fn() },
}));

vi.mock("../../../../shared/api/chat-command-api", () => ({
  chatCommandApi: { groupDelete: vi.fn() },
}));

vi.mock("../../../../engine/modes/chat/autonomous/activity-state", () => ({
  clearChatActivity: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn() },
}));

type DeleteContext = {
  previous?: Chat[];
  previousSummaries: Array<[readonly unknown[], Chat[] | undefined]>;
  previousGroup?: Chat[];
  groupId?: string | null;
};

type DeleteMutationOptions = {
  onMutate: (input: string) => Promise<DeleteContext>;
  onError: (error: unknown, input: string, context: DeleteContext) => void;
};

function chat(id: string): Chat {
  return {
    id,
    name: id === "deleted-chat" ? "New Conversation" : "Keep",
    mode: "conversation",
    characterIds: [],
    groupId: null,
    personaId: null,
    promptPresetId: null,
    connectionId: null,
    connectedChatId: null,
    folderId: null,
    sortOrder: 0,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    metadata: {
      summary: null,
      tags: [],
      agentOverrides: {},
      activeAgentIds: [],
      activeToolIds: [],
      presetChoices: {},
    },
  };
}

function ids(rows: Chat[] | undefined) {
  return rows?.map((row) => row.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  reactQueryMocks.currentQueryClient = null;
});

describe("useDeleteChat", () => {
  it("does not resurrect an optimistically removed chat after an ambiguous remote timeout", async () => {
    const qc = new QueryClient();
    const rows = [chat("deleted-chat"), chat("keep-chat")];
    qc.setQueryData(chatKeys.list(), rows);
    qc.setQueryData(chatKeys.summaries(), rows);
    reactQueryMocks.currentQueryClient = qc;
    const options = useDeleteChat() as unknown as DeleteMutationOptions;

    const context = await options.onMutate("deleted-chat");
    options.onError(
      new ApiError("Remote runtime request timed out after 30 seconds.", 504, {
        code: "remote_runtime_timeout",
      }),
      "deleted-chat",
      context,
    );

    expect(ids(qc.getQueryData<Chat[]>(chatKeys.list()))).toEqual(["keep-chat"]);
    expect(ids(qc.getQueryData<Chat[]>(chatKeys.summaries()))).toEqual(["keep-chat"]);
  });

  it("restores the previous chat data after a definite delete failure", async () => {
    const qc = new QueryClient();
    const rows = [chat("deleted-chat"), chat("keep-chat")];
    qc.setQueryData(chatKeys.list(), rows);
    qc.setQueryData(chatKeys.summaries(), rows);
    reactQueryMocks.currentQueryClient = qc;
    const options = useDeleteChat() as unknown as DeleteMutationOptions;

    const context = await options.onMutate("deleted-chat");
    options.onError(new ApiError("Delete failed.", 500, { code: "storage_error" }), "deleted-chat", context);

    expect(ids(qc.getQueryData<Chat[]>(chatKeys.list()))).toEqual(["deleted-chat", "keep-chat"]);
    expect(ids(qc.getQueryData<Chat[]>(chatKeys.summaries()))).toEqual(["deleted-chat", "keep-chat"]);
  });
});

type BulkDeleteMutationOptions = {
  onMutate: (input: { ids: string[]; deleteMemories: boolean }) => Promise<void>;
  onSettled: () => void;
  onError?: unknown;
};

describe("useDeleteChats", () => {
  it("removes the chats from list, summary, and group caches, then refetches instead of restoring", async () => {
    const qc = new QueryClient();
    const grouped = { ...chat("grouped-chat"), groupId: "group-1" };
    qc.setQueryData(chatKeys.list(), [chat("deleted-chat"), chat("keep-chat")]);
    qc.setQueryData(chatKeys.summaries(), [chat("deleted-chat"), chat("keep-chat")]);
    // A group view can hold a selected chat that the list caches do not.
    qc.setQueryData(chatKeys.group("group-1"), [grouped, chat("keep-chat")]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    reactQueryMocks.currentQueryClient = qc;
    const options = useDeleteChats() as unknown as BulkDeleteMutationOptions;

    await options.onMutate({ ids: ["deleted-chat", "grouped-chat"], deleteMemories: false });

    expect(ids(qc.getQueryData<Chat[]>(chatKeys.list()))).toEqual(["keep-chat"]);
    expect(ids(qc.getQueryData<Chat[]>(chatKeys.summaries()))).toEqual(["keep-chat"]);
    expect(ids(qc.getQueryData<Chat[]>(chatKeys.group("group-1")))).toEqual(["keep-chat"]);

    // A failed batch can still have deleted some chats, so there is no snapshot rollback.
    expect(options.onError).toBeUndefined();
    options.onSettled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [...chatKeys.all, "group"] });
  });
});
