import { describe, expect, it } from "vitest";

import { buildConversationMusicContext } from "./music-dj-conversation-context";

describe("buildConversationMusicContext", () => {
  it("uses recent conversation messages instead of fantasy tavern fallback music", () => {
    const context = buildConversationMusicContext({
      chatName: "Late Night DMs",
      characterNames: ["Chai"],
      personaName: "Celia",
      messages: [
        { role: "assistant", content: "The rain keeps tapping the window while I help you study." },
        { role: "user", content: "I laugh and tell you the exam prep is finally less scary." },
      ],
    });

    expect(context?.query).toContain("cozy reflective");
    expect(context?.query).toContain("rainy room");
    expect(context?.query).toContain("modern conversation instrumental ambience soundtrack");
    expect(context?.query).not.toContain("fantasy tavern");
    expect(context?.intent.reason).toContain("rain keeps tapping");
  });

  it("returns no context when there is nothing meaningful to seed the Music Player", () => {
    expect(buildConversationMusicContext({ messages: [] })).toBeNull();
  });
});
