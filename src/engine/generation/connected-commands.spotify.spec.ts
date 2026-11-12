import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway, SpotifyMusicGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import { persistConnectedCommandTags, spotifyCommandAvailable } from "./connected-commands";

const track = {
  provider: "spotify",
  id: "spotify:track:abc",
  title: "Merry-Go-Round",
  channelOrArtist: "Joe Hisaishi",
};

function integrations(spotify: Partial<SpotifyMusicGateway>): IntegrationGateway {
  return {
    music: { spotify: spotify as SpotifyMusicGateway },
  } as unknown as IntegrationGateway;
}

function storage(metadata: Record<string, unknown>) {
  const patchChatMetadata = vi.fn(async () => ({}));
  const gateway = {
    get: vi.fn(async () => ({ id: "chat-1", metadata })),
    patchChatMetadata,
  } as unknown as StorageGateway;
  return { gateway, patchChatMetadata };
}

const conversation = { id: "chat-1", mode: "conversation", metadata: {} };

describe("[spotify: …] availability", () => {
  it("is offered only in Conversation chats with commands on while Spotify is ready", async () => {
    const ready = integrations({ isReady: async () => true });
    expect(await spotifyCommandAvailable(conversation, ready)).toBe(true);
    expect(await spotifyCommandAvailable(conversation, integrations({ isReady: async () => false }))).toBe(false);
    expect(await spotifyCommandAvailable({ ...conversation, mode: "roleplay" }, ready)).toBe(false);
    expect(await spotifyCommandAvailable({ ...conversation, metadata: { characterCommands: false } }, ready)).toBe(
      false,
    );
    expect(await spotifyCommandAvailable(conversation, {} as IntegrationGateway)).toBe(false);
  });
});

describe("[spotify: …] execution", () => {
  it("plays the best match on repeat, records it and makes it the widget's track", async () => {
    const findTrack = vi.fn(async () => track);
    const playOnRepeat = vi.fn(async () => ({
      state: "accepted",
      message: "Spotify accepted the track; waiting for Desk.",
    }));
    const { gateway, patchChatMetadata } = storage({ musicRecentTracks: [{ provider: "youtube", id: "vid" }] });

    const result = await persistConnectedCommandTags(
      gateway,
      conversation,
      'This one.\n[spotify: title="Merry-Go-Round", artist="Joe Hisaishi"]',
      integrations({ isReady: async () => true, findTrack, playOnRepeat } as Partial<SpotifyMusicGateway>),
    );

    expect(result.displayContent).toBe("This one.");
    expect(findTrack).toHaveBeenCalledWith({ title: "Merry-Go-Round", artist: "Joe Hisaishi" });
    expect(playOnRepeat).toHaveBeenCalledWith({ track });
    expect(patchChatMetadata).toHaveBeenCalledWith("chat-1", {
      musicRecentTracks: [
        { provider: "spotify", id: "spotify:track:abc" },
        { provider: "youtube", id: "vid" },
      ],
    });
    expect(result.executedCommands).toEqual(["spotify"]);
    expect(result.events).toContainEqual({
      type: "music_now_playing",
      data: { chatId: "chat-1", track, message: "Spotify accepted the track; waiting for Desk." },
    });
  });

  it("reports failures as command errors with Spotify's message", async () => {
    const { gateway, patchChatMetadata } = storage({});
    const notFound = await persistConnectedCommandTags(
      gateway,
      conversation,
      '[spotify: title="Nope", artist="Nobody"]',
      integrations({
        isReady: async () => true,
        findTrack: async () => {
          throw new Error("Spotify didn't find 'Nope' by Nobody.");
        },
      } as Partial<SpotifyMusicGateway>),
    );
    expect(notFound.events).toContainEqual({
      type: "command_error",
      data: { command: "spotify", error: "Spotify didn't find 'Nope' by Nobody." },
    });

    const disconnected = await persistConnectedCommandTags(
      gateway,
      conversation,
      '[spotify: title="Song", artist="Band"]',
      integrations({ isReady: async () => false }),
    );
    expect(disconnected.events).toContainEqual({
      type: "command_error",
      data: { command: "spotify", error: "Spotify isn't connected. Open Music Player settings to connect it." },
    });
    expect(patchChatMetadata).not.toHaveBeenCalled();
  });
});
