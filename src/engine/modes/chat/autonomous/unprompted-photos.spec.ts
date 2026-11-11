import { describe, expect, it } from "vitest";
import { burstAlreadyHasPhoto, decideTextsFirstPhoto, sentPhotoHistoryNote } from "./unprompted-photos";

const photo = { attachments: [{ type: "image", url: "/gallery/a.png", description: "at the pier" }] };
const chat = (metadata: Record<string, unknown>) => ({ id: "c", mode: "conversation", metadata });
const ready = { imageGenConnectionId: "img" };

describe("texts-first photos", () => {
  it("rolls against the character's frequency, default rare", () => {
    const decide = (metadata: Record<string, unknown>, roll: number) =>
      decideTextsFirstPhoto({ chat: chat(metadata), characterId: "mira", messages: [], random: () => roll });

    expect(decide(ready, 0.1)).toBe("send"); // rare = 15%
    expect(decide(ready, 0.2)).toBe("withhold");
    expect(decide({ ...ready, unpromptedPhotoFrequency: { mira: "sometimes" } }, 0.3)).toBe("send");
    expect(decide({ ...ready, unpromptedPhotoFrequency: { mira: "never" } }, 0)).toBe("withhold");
  });

  it("is skipped when the chat can't make selfies", () => {
    const decide = (metadata: Record<string, unknown>) =>
      decideTextsFirstPhoto({ chat: chat(metadata), characterId: "mira", messages: [], random: () => 0 });

    expect(decide({})).toBe("withhold");
    expect(decide({ ...ready, characterCommands: false })).toBe("withhold");
    expect(decide({ ...ready, commandCapabilities: { selfie: false } })).toBe("withhold");
  });

  it("caps photos at one per burst, counted from the user's last message", () => {
    const user = { role: "user", extra: {} };
    const text = { role: "assistant", extra: {} };
    const sent = { role: "assistant", extra: photo };

    expect(burstAlreadyHasPhoto([user, text, sent, text])).toBe(true);
    expect(burstAlreadyHasPhoto([sent, user, text])).toBe(false);
    expect(
      decideTextsFirstPhoto({ chat: chat(ready), characterId: "mira", messages: [user, sent], random: () => 0 }),
    ).toBe("withhold");
  });

  it("describes a sent photo for later prompts without the image itself", () => {
    expect(sentPhotoHistoryNote(photo)).toBe("(sent a photo: at the pier)");
    expect(sentPhotoHistoryNote({ attachments: [{ type: "image", url: "/gallery/b.png" }] })).toBe("(sent a photo)");
    expect(sentPhotoHistoryNote({})).toBe("");
  });
});
