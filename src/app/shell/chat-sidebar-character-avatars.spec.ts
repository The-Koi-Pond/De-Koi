import { describe, expect, it, vi } from "vitest";

import { buildChatSidebarCharacterLookup } from "./chat-sidebar-character-avatars";

const localFileApi = vi.hoisted(() => ({
  avatarFileUrlFromPath: vi.fn(),
}));

vi.mock("../../shared/api/local-file-api", () => localFileApi);

describe("chat sidebar character avatars", () => {
  it("keeps managed avatar metadata so visible rows can resolve throttled thumbnails", () => {
    localFileApi.avatarFileUrlFromPath.mockReturnValue(null);

    const lookup = buildChatSidebarCharacterLookup([
      {
        id: "char-1",
        data: {
          name: "The Clown",
          extensions: {
            avatarCrop: { srcX: 0.1, srcY: 0.2, srcWidth: 0.4, srcHeight: 0.5 },
            conversationStatus: "idle",
          },
        },
        avatarPath: null,
        avatarFilePath: "C:\\avatars\\clown.png",
        avatarFilename: "clown.png",
      },
    ]);

    expect(localFileApi.avatarFileUrlFromPath).toHaveBeenCalledWith("clown.png", "C:\\avatars\\clown.png");
    expect(lookup.get("char-1")).toMatchObject({
      name: "The Clown",
      avatarUrl: null,
      avatarFilePath: "C:\\avatars\\clown.png",
      avatarFilename: "clown.png",
      hasAvatarSource: true,
      conversationStatus: "idle",
    });
  });
});
