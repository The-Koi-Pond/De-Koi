import { describe, expect, it } from "vitest";
import { ttsConfigSchema } from "../../../../engine/contracts/types/tts";
import { voicePerformsDeliveryTags } from "./voice-call-ports";

const config = (patch: Record<string, unknown>) =>
  ttsConfigSchema.parse({ enabled: true, source: "elevenlabs", baseUrl: "https://api.elevenlabs.io", ...patch });

describe("voicePerformsDeliveryTags", () => {
  it("is on for ElevenLabs Eleven v3 and v4 voices", () => {
    expect(voicePerformsDeliveryTags(config({ model: "eleven_v4" }))).toBe(true);
    expect(voicePerformsDeliveryTags(config({ model: "eleven_v3" }))).toBe(true);
    expect(voicePerformsDeliveryTags(config({ model: "eleven_v4_turbo" }))).toBe(true);
  });

  it("is off where the tag would be read out loud, or nothing is spoken", () => {
    expect(voicePerformsDeliveryTags(config({ model: "eleven_multilingual_v2" }))).toBe(false);
    expect(voicePerformsDeliveryTags(config({ model: "eleven_flash_v2_5" }))).toBe(false);
    expect(voicePerformsDeliveryTags(config({ model: "eleven_v40" }))).toBe(false);
    expect(voicePerformsDeliveryTags(config({ model: "eleven_v4", baseUrl: "https://nano-gpt.com/api" }))).toBe(false);
    expect(voicePerformsDeliveryTags(config({ source: "openai", model: "gpt-4o-mini-tts" }))).toBe(false);
    expect(voicePerformsDeliveryTags(config({ model: "eleven_v4", enabled: false }))).toBe(false);
    expect(voicePerformsDeliveryTags(null)).toBe(false);
  });
});
