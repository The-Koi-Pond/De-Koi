import { describe, expect, it } from "vitest";
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import {
  buildVoiceConfigSignature,
  getGameSideLineVoiceKeyForRequests,
  getGameSegmentVoiceKeyForRequests,
  getGameSegmentVoiceRequest,
  getGameVoicePlayerSpeakerNames,
  queueGameVoiceEntryPlan,
  resolveGameVoiceEntryPlan,
  type GameSegmentVoiceEntry,
} from "./game-narration-voice";
import type { NarrationSegment } from "./game-narration-segments";

const baseTtsConfig: TTSConfig = {
  enabled: true,
  source: "openai",
  baseUrl: "https://api.openai.com/v1",
  voicesPath: "",
  apiKey: "",
  voice: "alloy",
  narratorVoiceEnabled: false,
  narratorVoice: "",
  model: "tts-1",
  audioFormat: "mp3",
  requestTimeoutMs: 60_000,
  speed: 1,
  elevenLabsStability: 0.5,
  elevenLabsLanguageCode: "",
  voiceMode: "single",
  voiceAssignments: [],
  npcDefaultVoicesEnabled: false,
  npcDefaultMaleVoices: [],
  npcDefaultFemaleVoices: [],
  autoplayRP: false,
  autoplayConvo: false,
  autoplayGame: false,
  autoplayStreaming: false,
  dialogueOnly: false,
  dialogueScope: "all",
  dialogueCharacterName: "",
};

function segment(overrides: Partial<NarrationSegment> = {}): NarrationSegment {
  return {
    id: "s1",
    type: "dialogue",
    speaker: "Amber",
    sprite: "happy_smile",
    content: "Light it up.",
    sourceMessageId: "m1",
    sourceSegmentIndex: 0,
    sourceRole: "assistant",
    ...overrides,
  };
}

describe("game narration voice planning", () => {
  it("builds dialogue voice requests with speaker, emotion tone, and chunks", () => {
    const request = getGameSegmentVoiceRequest(segment(), baseTtsConfig, [
      {
        id: "npc-amber",
        name: "Amber",
        emoji: "",
        description: "A cheerful archer",
        location: "",
        reputation: 0,
        met: true,
        notes: [],
      },
    ]);

    expect(request).toEqual({
      chunks: ["Light it up."],
      speaker: "Amber",
      tone: "happy",
      voice: "alloy",
    });
  });

  it("skips user/system/thought/player-owned narration for game voice", () => {
    const playerNames = getGameVoicePlayerSpeakerNames("Traveler");

    expect(getGameSegmentVoiceRequest(segment({ sourceRole: "user" }), baseTtsConfig, [], { playerSpeakerNames: playerNames })).toBeNull();
    expect(getGameSegmentVoiceRequest(segment({ sourceRole: "system" }), baseTtsConfig, [], { playerSpeakerNames: playerNames })).toBeNull();
    expect(getGameSegmentVoiceRequest(segment({ partyType: "thought" }), baseTtsConfig, [], { playerSpeakerNames: playerNames })).toBeNull();
    expect(getGameSegmentVoiceRequest(segment({ speaker: "Traveler" }), baseTtsConfig, [], { playerSpeakerNames: playerNames })).toBeNull();
    expect(
      getGameSegmentVoiceRequest(
        segment({ type: "narration", speaker: undefined, content: "[Traveler] looks around." }),
        baseTtsConfig,
        [],
        { playerSpeakerNames: playerNames },
      ),
    ).toBeNull();
  });

  it("keys voice cache entries by source identity, config, and line text", () => {
    const signature = buildVoiceConfigSignature(baseTtsConfig);
    const firstRequest = getGameSegmentVoiceRequest(segment({ content: "Light it up." }), baseTtsConfig);
    const changedRequest = getGameSegmentVoiceRequest(segment({ content: "Hold the line." }), baseTtsConfig);
    expect(firstRequest).not.toBeNull();
    expect(changedRequest).not.toBeNull();

    expect(getGameSegmentVoiceKeyForRequests(segment(), signature, [firstRequest!])).not.toBe(
      getGameSegmentVoiceKeyForRequests(segment(), signature, [changedRequest!]),
    );

    const sideLine = {
      character: "Amber",
      type: "side" as const,
      content: "Light it up.",
    };
    const changedSideLine = {
      ...sideLine,
      content: "Hold the line.",
    };
    expect(getGameSideLineVoiceKeyForRequests(segment(), sideLine, 0, signature, [firstRequest!])).not.toBe(
      getGameSideLineVoiceKeyForRequests(segment(), changedSideLine, 0, signature, [changedRequest!]),
    );
  });

  it("queues voice plans with explicit cache and abort-controller state", () => {
    const cache = new Map<string, GameSegmentVoiceEntry>();
    const pending = new Map<string, AbortController>();
    const request = getGameSegmentVoiceRequest(segment(), baseTtsConfig);
    expect(request).not.toBeNull();

    const key = getGameSegmentVoiceKeyForRequests(segment(), buildVoiceConfigSignature(baseTtsConfig), [request!]);
    const plan = queueGameVoiceEntryPlan({
      key,
      requests: [request!],
      config: baseTtsConfig,
      cache,
      pending,
    });

    expect(plan?.key).toBe(key);
    expect(plan?.controller.signal.aborted).toBe(false);
    expect(cache.get(key!)?.status).toBe("loading");
    expect(pending.get(key!)).toBe(plan?.controller);

    plan?.controller.abort();
    expect(plan?.controller.signal.aborted).toBe(true);
    expect(queueGameVoiceEntryPlan({ key, requests: [request!], config: baseTtsConfig, cache, pending })).toBeNull();
  });

  it("clears pending state when a queued voice plan is aborted before resolution", async () => {
    const cache = new Map<string, GameSegmentVoiceEntry>();
    const pending = new Map<string, AbortController>();
    const request = getGameSegmentVoiceRequest(segment(), baseTtsConfig);
    const key = getGameSegmentVoiceKeyForRequests(segment(), buildVoiceConfigSignature(baseTtsConfig), [request!]);
    const plan = queueGameVoiceEntryPlan({
      key,
      requests: [request!],
      config: baseTtsConfig,
      cache,
      pending,
    });
    expect(plan).not.toBeNull();

    plan!.controller.abort();
    await expect(resolveGameVoiceEntryPlan({ plan: plan!, cache, pending })).resolves.toBe(false);
    expect(pending.has(key!)).toBe(false);
    expect(queueGameVoiceEntryPlan({ key, requests: [request!], config: baseTtsConfig, cache: new Map(), pending })).not.toBeNull();
  });
});
