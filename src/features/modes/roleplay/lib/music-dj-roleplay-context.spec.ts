import { describe, expect, it } from "vitest";

import { buildRoleplayMusicContext, shouldDispatchRoleplayMusicContext } from "./music-dj-roleplay-context";

describe("buildRoleplayMusicContext", () => {
  it("uses loaded roleplay messages instead of the generic tavern fallback", () => {
    const context = buildRoleplayMusicContext({
      chatName: "Pine Rest",
      characterNames: ["Chai"],
      messages: [
        {
          role: "assistant",
          content: '"Sleep," he grunts, his chest dropping in a long, warm sigh that smells of copper and old pine.',
        },
        { role: "user", content: "I fall asleep on him." },
      ],
    });

    expect(context?.query).toContain("somber wounded");
    expect(context?.query).toContain("forest cabin");
    expect(context?.query).toContain("instrumental ambience soundtrack");
    expect(context?.query).not.toContain("fantasy tavern");
    expect(context?.intent.reason).toContain("copper and old pine");
  });

  it("only asks for tavern music when the roleplay context says tavern", () => {
    const context = buildRoleplayMusicContext({
      chatMeta: { sceneDescription: "A crowded tavern with a roaring hearth and spilled ale." },
      messages: [],
    });

    expect(context?.query).toContain("fantasy tavern");
  });

  it("uses character profile tone when recent roleplay messages are generic", () => {
    const context = buildRoleplayMusicContext({
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
    });

    expect(context?.query).toContain("dark suspense");
    expect(context?.query).toContain("royal fantasy");
    expect(context?.query).toContain("horror");
    expect(context?.intent.reason).toContain("gothic vampire noble");
  });
  it("seeds Fresh Pick context for roleplay independently of Music Player agent activation", () => {
    const context = buildRoleplayMusicContext({
      messages: [{ role: "assistant", content: "Rain hisses against the neon station windows." }],
    });

    expect(shouldDispatchRoleplayMusicContext("roleplay", context, new Set())).toBe(true);
    expect(shouldDispatchRoleplayMusicContext("roleplay", null, new Set())).toBe(true);
  });

  it("returns no context when there is nothing meaningful to seed Fresh Pick", () => {
    expect(buildRoleplayMusicContext({ messages: [] })).toBeNull();
  });
});
