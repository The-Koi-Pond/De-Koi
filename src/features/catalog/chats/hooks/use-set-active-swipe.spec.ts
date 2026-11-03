import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../../../engine/contracts/types/chat";
import { chatKeys } from "../query-keys";
import { useSetActiveSwipe } from "./use-chats";

// Hooks import useMutation through the app wrapper; route it to the mocked TanStack hook.
vi.mock("../../../../shared/hooks/use-mutation", async () => ({
  useMutation: (await import("@tanstack/react-query")).useMutation,
}));

const mocks = vi.hoisted(() => ({
  currentQueryClient: null as QueryClient | null,
  useMutation: vi.fn((options) => options),
}));

vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: mocks.useMutation,
    useQueryClient: () => {
      if (!mocks.currentQueryClient) throw new Error("Missing QueryClient for test.");
      return mocks.currentQueryClient;
    },
  };
});

type MutationOptions = {
  onMutate: (variables: { messageId: string; index: number }) => unknown;
  onSuccess: (updated: Message | null, variables: { messageId: string; index: number }) => void;
};

const SECOND_VERSION = { models: [{ connectionId: "conn-b", name: "Drafter", model: "small-model" }] };
const FIRST_VERSION = { models: [{ connectionId: "conn-a", name: "Writer", model: "big-model" }] };

function chapter(extra: Message["extra"]): Message & { swipePreviews: Array<{ content: string }> } {
  return {
    id: "chapter-1",
    chatId: "fic-1",
    role: "assistant",
    characterId: null,
    content: "Second draft.",
    activeSwipeIndex: 1,
    swipeCount: 2,
    swipePreviews: [{ content: "First draft." }, { content: "Second draft." }],
    extra,
    createdAt: "2026-10-25T12:00:00.000Z",
  };
}

function cachedChapter(qc: QueryClient): Message | undefined {
  return qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("fic-1"))?.pages[0]?.[0];
}

beforeEach(() => {
  mocks.currentQueryClient = null;
  mocks.useMutation.mockClear();
});

describe("useSetActiveSwipe", () => {
  it("doesn't show one chapter version's models on another while switching, then shows the switched-to version's", () => {
    const qc = new QueryClient();
    vi.spyOn(qc, "cancelQueries").mockResolvedValue();
    const extra = { fanficVersion: SECOND_VERSION, hiddenFromAI: false } as unknown as Message["extra"];
    qc.setQueryData<InfiniteData<Message[]>>(chatKeys.messages("fic-1"), {
      pages: [[chapter(extra)]],
      pageParams: [undefined],
    });
    mocks.currentQueryClient = qc;
    const options = useSetActiveSwipe("fic-1") as unknown as MutationOptions;
    const variables = { messageId: "chapter-1", index: 0 };

    options.onMutate(variables);
    expect(cachedChapter(qc)?.content).toBe("First draft.");
    expect(cachedChapter(qc)?.extra).toEqual({ hiddenFromAI: false });

    options.onSuccess(
      {
        ...chapter({ fanficVersion: FIRST_VERSION, hiddenFromAI: false } as unknown as Message["extra"]),
        content: "First draft.",
        activeSwipeIndex: 0,
      },
      variables,
    );
    expect(cachedChapter(qc)?.extra).toEqual({ fanficVersion: FIRST_VERSION, hiddenFromAI: false });
  });
});
