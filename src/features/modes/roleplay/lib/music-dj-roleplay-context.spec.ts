import { describe, expect, it } from "vitest";

import { buildRoleplayMusicContext } from "./music-dj-roleplay-context";

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

  it("returns no context when there is nothing meaningful to seed Fresh Pick", () => {
    expect(buildRoleplayMusicContext({ messages: [] })).toBeNull();
  });
});
