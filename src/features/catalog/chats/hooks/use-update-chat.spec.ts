import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../shared/api/storage-api";
import { chatKeys } from "../query-keys";
import { useUpdateChat } from "./use-chats";

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
  storageApi: { get: vi.fn(), update: vi.fn() },
}));

type ChatUpdate = { id: string; characterIds?: string[]; name?: string };
type MutationOptions = {
  mutationFn: (variables: ChatUpdate) => Promise<unknown>;
  onMutate: (variables: ChatUpdate) => unknown;
};

const characterNames: Record<string, string> = { mira: "Mira", rook: "Rook" };

function seedChat(chat: Record<string, unknown>) {
  const qc = new QueryClient();
  qc.setQueryData(chatKeys.detail("chat-1"), { id: "chat-1", mode: "conversation", ...chat });
  reactQueryMocks.currentQueryClient = qc;
  vi.mocked(storageApi.get).mockImplementation(async (_entity: string, id: string) => ({
    id,
    data: { name: characterNames[id] },
  }));
  vi.mocked(storageApi.update).mockResolvedValue({});
}

async function addRook(options: MutationOptions) {
  const variables = { id: "chat-1", characterIds: ["mira", "rook"] };
  // TanStack runs onMutate (the optimistic cache patch) before mutationFn.
  await options.onMutate(variables);
  await options.mutationFn(variables);
}

beforeEach(() => {
  vi.clearAllMocks();
  reactQueryMocks.currentQueryClient = null;
});

describe("useUpdateChat character titles", () => {
  it("retitles a chat whose name came from its previous characters", async () => {
    seedChat({ name: "Mira", characterIds: ["mira"] });
    await addRook(useUpdateChat() as unknown as MutationOptions);

    expect(storageApi.update).toHaveBeenCalledWith("chats", "chat-1", {
      characterIds: ["mira", "rook"],
      name: "Mira, Rook",
    });
  });

  it("keeps a name the user typed", async () => {
    seedChat({ name: "Scene: Knives, No Audience", characterIds: ["mira"] });
    await addRook(useUpdateChat() as unknown as MutationOptions);

    expect(storageApi.update).toHaveBeenCalledWith("chats", "chat-1", { characterIds: ["mira", "rook"] });
  });
});
