import { describe, expect, it } from "vitest";
import { VOICE_CALL_DELIVERY_INSTRUCTION, VOICE_CALL_DELIVERY_TAGS, stripDeliveryTags } from "./delivery-tags";

describe("voice call delivery tags", () => {
  it("removes the offered tags and the space after each", () => {
    expect(stripDeliveryTags("[sighs] night is the only time. [Laughs] kidding.")).toBe(
      "night is the only time. kidding.",
    );
    expect(stripDeliveryTags("[whispers]come closer\n[excited] OK!")).toBe("come closer\nOK!");
  });

  it("leaves every other bracket alone", () => {
    expect(stripDeliveryTags("[react: 😂] [selfie] [dances] (sighs) *sighs* sighs")).toBe(
      "[react: 😂] [selfie] [dances] (sighs) *sighs* sighs",
    );
  });

  it("offers exactly the tags it removes", () => {
    for (const tag of VOICE_CALL_DELIVERY_TAGS) {
      expect(VOICE_CALL_DELIVERY_INSTRUCTION).toContain(`[${tag}]`);
      expect(stripDeliveryTags(`[${tag}] hi`)).toBe("hi");
    }
  });
});
