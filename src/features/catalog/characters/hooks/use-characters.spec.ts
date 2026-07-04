import { useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../shared/api/storage-api";
import { useCharacterLibrarySummaries, useChatSurfaceCharacterSummariesByIds } from "./use-characters";

vi.mock("react", () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn((options) => options),
  useQueries: vi.fn(() => []),
  useQuery: vi.fn((options) => options),
  useQueryClient: vi.fn(() => ({
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
    setQueryData: vi.fn(),
  })),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/character-api", () => ({
  characterApi: {
    removeAvatar: vi.fn(),
    restoreVersion: vi.fn(),
    update: vi.fn(),
    uploadAvatar: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/storage-commands-api", () => ({
  storageCommandsApi: {
    duplicate: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/image-generation-api", () => ({
  galleryApi: {
    uploadCharacter: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/local-file-api", () => ({
  resolveGalleryFileUrl: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("character library summary query", () => {
  it("uses a lightweight projection for the initial library load", async () => {
    vi.mocked(storageApi.list).mockResolvedValue([]);

    const query = useCharacterLibrarySummaries() as unknown as { queryFn: () => Promise<unknown> };
    await query.queryFn();

    expect(useQuery).toHaveBeenCalledTimes(1);
    expect(storageApi.list).toHaveBeenCalledWith(
      "characters",
      expect.objectContaining({
        fields: ["id", "data", "comment", "avatarPath", "avatarFilePath", "avatarFilename", "createdAt", "updatedAt"],
        fieldSelections: {
          data: expect.arrayContaining([
            "name",
            "description",
            "personality",
            "tags",
            "extensions.avatarCrop",
            "extensions.fav",
            "extensions.publicProfile",
          ]),
        },
      }),
    );

    const options = vi.mocked(storageApi.list).mock.calls[0]?.[1] as
      | { fieldSelections?: { data?: string[] } }
      | undefined;
    expect(options?.fieldSelections?.data).not.toEqual(
      expect.arrayContaining([
        "scenario",
        "first_mes",
        "mes_example",
        "creator_notes",
        "system_prompt",
        "post_history_instructions",
        "alternate_greetings",
        "character_book",
        "extensions",
      ]),
    );
  });
});

describe("chat surface character summary query", () => {
  it("uses a lightweight projection for chat and shell avatar lookups", async () => {
    vi.mocked(storageApi.list).mockResolvedValue([]);

    useChatSurfaceCharacterSummariesByIds(["character-1"]);

    expect(useQuery).toHaveBeenCalledTimes(1);
    const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0] as unknown as
      | { queryFn: () => Promise<unknown> }
      | undefined;
    await queryOptions?.queryFn();

    expect(storageApi.list).toHaveBeenCalledWith(
      "characters",
      expect.objectContaining({
        fields: ["id", "data", "comment", "avatarPath", "avatarFilePath", "avatarFilename", "createdAt", "updatedAt"],
        whereIn: { field: "id", values: ["character-1"] },
        fieldSelections: {
          data: expect.arrayContaining([
            "name",
            "description",
            "personality",
            "scenario",
            "mes_example",
            "creator",
            "creator_notes",
            "character_version",
            "system_prompt",
            "post_history_instructions",
            "tags",
            "extensions.backstory",
            "extensions.appearance",
            "extensions.avatarCrop",
            "extensions.fav",
            "extensions.conversationStatus",
            "extensions.conversationActivity",
            "extensions.nameColor",
            "extensions.publicProfile",
          ]),
        },
      }),
    );

    const options = vi.mocked(storageApi.list).mock.calls[0]?.[1] as
      | { fieldSelections?: { data?: string[] } }
      | undefined;
    expect(options?.fieldSelections?.data).not.toEqual(
      expect.arrayContaining(["first_mes", "alternate_greetings", "character_book"]),
    );
  });
});
