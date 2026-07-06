import { describe, expect, it } from "vitest";

import { buildConversationMusicContext } from "./music-dj-conversation-context";

describe("buildConversationMusicContext", () => {
  it("does not infer Music Player cues from conversation keywords", () => {
    expect(
      buildConversationMusicContext({
        chatName: "Late Night DMs",
        characterNames: ["Chai"],
        personaName: "Celia",
        messages: [
          { role: "assistant", content: "The rain keeps tapping the window while I help you study." },
          { role: "user", content: "I laugh and tell you the exam prep is finally less scary." },
        ],
      }),
    ).toBeNull();

    expect(
      buildConversationMusicContext({
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
      }),
    ).toBeNull();
  });

  it("returns no context when there is nothing meaningful to seed the Music Player", () => {
    expect(buildConversationMusicContext({ messages: [] })).toBeNull();
  });
});
