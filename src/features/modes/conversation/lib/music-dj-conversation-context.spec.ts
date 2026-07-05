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

  it("uses character profile tone when recent conversation messages are generic", () => {
    const context = buildConversationMusicContext({
      chatName: "Daily Check-In",
      characterProfiles: [
        {
          name: "Nyx",
          description: "A cyberpunk android detective from a rain-slick neon city.",
          personality: "Dry noir wit, guarded warmth, and precise focus.",
        },
      ],
      personaProfile: { name: "Celia", personality: "Soft-spoken but sharp when solving mysteries." },
      messages: [{ role: "assistant", content: "How was your day?" }],
    });

    expect(context?.query).toContain("noir conversation");
    expect(context?.query).toContain("neon city chat");
    expect(context?.query).toContain("noir ambient");
    expect(context?.intent.reason).toContain("cyberpunk android detective");
  });
  it("returns no context when there is nothing meaningful to seed the Music Player", () => {
    expect(buildConversationMusicContext({ messages: [] })).toBeNull();
  });
});
