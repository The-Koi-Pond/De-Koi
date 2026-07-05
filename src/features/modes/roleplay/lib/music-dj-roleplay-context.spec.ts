import { describe, expect, it } from "vitest";

import { buildRoleplayMusicContext, shouldDispatchRoleplayMusicContext } from "./music-dj-roleplay-context";

describe("buildRoleplayMusicContext", () => {
  it("does not infer Music Player cues from roleplay keywords", () => {
    expect(
      buildRoleplayMusicContext({
        chatName: "Pine Rest",
        characterNames: ["Chai"],
        messages: [
          {
            role: "assistant",
            content: '"Sleep," he grunts, his chest dropping in a long, warm sigh that smells of copper and old pine.',
          },
          { role: "user", content: "I fall asleep on him." },
        ],
      }),
    ).toBeNull();

    expect(
      buildRoleplayMusicContext({
        chatMeta: { sceneDescription: "A crowded tavern with a roaring hearth and spilled ale." },
        messages: [],
      }),
    ).toBeNull();

    expect(
      buildRoleplayMusicContext({
        chatName: "Midnight Court",
        characterProfiles: [
          {
            name: "Mira",
            personality: "A gothic vampire noble with eerie restraint.",
            scenario: "A haunted moonlit castle where every quiet exchange feels dangerous.",
          },
        ],
        personaProfile: { name: "Celia", personality: "Careful, curious, and drawn to old mysteries." },
        messages: [{ role: "assistant", content: "She nods once and waits for your answer." }],
      }),
    ).toBeNull();
  });

  it("seeds Fresh Pick context for roleplay independently of Music Player agent activation", () => {
    expect(shouldDispatchRoleplayMusicContext("roleplay", null, new Set())).toBe(true);
    expect(shouldDispatchRoleplayMusicContext("roleplay", null, new Set(["music-dj"]))).toBe(true);
    expect(shouldDispatchRoleplayMusicContext("conversation", null, new Set())).toBe(false);
  });

  it("returns no context when there is nothing meaningful to seed Fresh Pick", () => {
    expect(buildRoleplayMusicContext({ messages: [] })).toBeNull();
  });
});
