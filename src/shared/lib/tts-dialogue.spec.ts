import { describe, expect, it } from "vitest";
import { ttsConfigSchema } from "../../engine/contracts/types/tts";
import type { TTSConfig } from "../../engine/contracts/types/tts";
import { withTTSVoiceRequestCacheKeys, type TTSVoiceRequest } from "./tts-dialogue";

function ttsConfig(overrides: Partial<TTSConfig> = {}): TTSConfig {
  return ttsConfigSchema.parse({ enabled: true, ...overrides });
}

const request: TTSVoiceRequest = {
  text: "Meet me under the old clock.",
  speaker: "Mina",
  tone: "urgent",
  voice: "alloy",
};

describe("withTTSVoiceRequestCacheKeys", () => {
  it("builds stable per-message keys with reusable text aliases", () => {
    const config = ttsConfig();
    const first = withTTSVoiceRequestCacheKeys([request], config, "msg-a");
    const same = withTTSVoiceRequestCacheKeys([request], config, "msg-a");
    const anotherMessage = withTTSVoiceRequestCacheKeys([request], config, "msg-b");

    expect(first).toEqual(same);
    expect(first[0].cacheKey).toMatch(/^chat-voice-line-v1:msg-a:0:/);
    expect(first[0].cacheAliases).toEqual(anotherMessage[0].cacheAliases);
    expect(first[0].cacheKey).not.toBe(anotherMessage[0].cacheKey);
  });

  it("changes text aliases when audio-affecting config changes", () => {
    const base = withTTSVoiceRequestCacheKeys([request], ttsConfig(), "msg-a");
    const changedModel = withTTSVoiceRequestCacheKeys([request], ttsConfig({ model: "tts-1-hd" }), "msg-a");

    expect(base[0].cacheAliases).not.toEqual(changedModel[0].cacheAliases);
  });
});
