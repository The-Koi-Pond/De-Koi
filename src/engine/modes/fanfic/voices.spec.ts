import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState, FanficVoiceSheet } from "../../contracts/types/fanfic";
import { buildFanficSystemSegments, renderFanficCastCards } from "./prompts";
import { createFanficState, defaultFanficRequest, readFanficState } from "./request";
import type { FanficWebResearchGateway, FanficWebSource } from "./research";
import { checkFanficChapterVoice, groundFanficVoiceIssues, parseFanficVoiceCheckReply } from "./voice-check";
import {
  buildFanficVoiceSheets,
  fanficVoiceCharacters,
  fanficVoiceQueries,
  groundFanficVoiceQuotes,
  parseFanficVoiceReply,
  withFanficVoices,
} from "./voices";

const request = {
  ...defaultFanficRequest(),
  fandom: "The Freak Circus",
  characters: ["Pierrot", "Harlequin", "Reader"],
  research: true,
};

const page: FanficWebSource = {
  query: "The Freak Circus Harlequin quotes",
  title: "Harlequin | The Freak Circus Wiki",
  url: "https://the-freak-circus.fandom.com/wiki/Harlequin",
  snippet: "",
  text: "Quotes “ I'm going to take you from him. ” — Harlequin, Day 1 “ For tonight, it's better your pretty eyes don't scream your doubts to everyone else. ” — Harlequin, Day 2",
};

const sheet = (name: string, extra: Partial<FanficVoiceSheet> = {}): FanficVoiceSheet => ({
  name,
  speech: `${name} talks like ${name}.`,
  neverSays: [],
  motives: "",
  quotes: [],
  ...extra,
});

function storageWith(fanfic: FanficState, messages: Array<Record<string, unknown>> = []) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": { id: "chat-1", mode: "fanfic", connectionId: "conn-1", characterIds: [], metadata: { fanfic } },
  };
  const storage = {
    async list<T = unknown>(_entity: StorageEntity): Promise<T[]> {
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "connections")
        return { id, provider: "claude_subscription", name: "Checker", model: "check-model" } as T;
      return (entity === "chats" ? (records[id] ?? null) : null) as T | null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
  } as unknown as StorageGateway;
  return { storage, records };
}

function scriptedLlm(replies: Array<string | ((request: LlmRequest) => string)>) {
  const requests: LlmRequest[] = [];
  const llm: LlmGateway = {
    complete: vi.fn(async (llmRequest: LlmRequest) => {
      requests.push(llmRequest);
      const next = replies.shift() ?? "";
      return typeof next === "function" ? next(llmRequest) : next;
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("voice sheet characters and searches", () => {
  it("leaves the reader insert out and aims searches at quote pages", () => {
    expect(fanficVoiceCharacters(request)).toEqual(["Pierrot", "Harlequin"]);
    expect(fanficVoiceQueries(request)).toEqual([
      "The Freak Circus Pierrot quotes",
      "The Freak Circus Harlequin quotes",
    ]);
  });
});

describe("groundFanficVoiceQuotes", () => {
  it("keeps only lines found word for word on a page read, with that page as the source", () => {
    const { quotes, dropped } = groundFanficVoiceQuotes(
      [
        { text: "“I'm going to take you from him.”", source: 1 },
        // Named the wrong source, but it is on a page read.
        { text: "it's better your pretty eyes don't scream your doubts", source: 7 },
        // Made up.
        { text: "Oh my dangerous dear, I adore a challenge.", source: 1 },
        // Too short to prove anything.
        { text: "Dear one.", source: 1 },
        // A repeat.
        { text: "I'm going to take you from him.", source: 1 },
      ],
      [page],
    );
    expect(quotes).toEqual([
      { text: "I'm going to take you from him.", source: page.title, url: page.url },
      { text: "it's better your pretty eyes don't scream your doubts", source: page.title, url: page.url },
    ]);
    expect(dropped).toBe(2);
  });
});

describe("parseFanficVoiceReply", () => {
  it("needs a sheet with a speech line for every character", () => {
    const reply = JSON.stringify({
      voices: [{ name: "pierrot", speech: "Courtly.", neverSays: ["bro"], motives: "Love.", quotes: [] }],
    });
    expect(() => parseFanficVoiceReply(reply, ["Pierrot", "Harlequin"], [])).toThrow(/no sheet for Harlequin/);
    expect(parseFanficVoiceReply(reply, ["Pierrot"], []).voices).toEqual([
      { name: "Pierrot", speech: "Courtly.", neverSays: ["bro"], motives: "Love.", quotes: [] },
    ]);
  });
});

describe("buildFanficVoiceSheets", () => {
  it("reads quote pages, keeps real lines, and saves without overwriting an outline saved meanwhile", async () => {
    const { storage, records } = storageWith(createFanficState(request));
    const web: FanficWebResearchGateway = { research: vi.fn(async () => ({ sources: [page], failures: [] })) };
    const { llm, requests } = scriptedLlm([
      () => {
        // The requester approves an outline while the sheets are being written.
        const metadata = records["chat-1"]!.metadata as { fanfic: FanficState };
        records["chat-1"] = {
          ...records["chat-1"],
          metadata: {
            fanfic: {
              ...metadata.fanfic,
              outline: { title: "T", summary: "", chapters: [{ number: 1, title: "One", summary: "x" }] },
              outlineApproved: true,
            },
          },
        };
        return JSON.stringify({
          voices: [
            { name: "Pierrot", speech: "Courtly.", neverSays: [], motives: "", quotes: [] },
            {
              name: "Harlequin",
              speech: "Purring.",
              neverSays: ["my dearest"],
              motives: "",
              quotes: [{ text: "I'm going to take you from him.", source: 1 }],
            },
          ],
        });
      },
    ]);

    const result = await buildFanficVoiceSheets({ storage, llm, web }, { chatId: "chat-1" });

    expect(web.research).toHaveBeenCalledWith({
      chatId: "chat-1",
      queries: ["The Freak Circus Pierrot quotes", "The Freak Circus Harlequin quotes"],
      focus: "voice",
    });
    expect(requests[0]!.messages[0]!.content).toContain("### Source 1: Harlequin | The Freak Circus Wiki");
    expect(result.pagesRead).toBe(1);
    const saved = readFanficState(records["chat-1"]!.metadata);
    expect(saved?.outlineApproved).toBe(true);
    expect(saved?.voices?.[1]?.quotes).toHaveLength(1);
  });

  it("refuses when the request names no characters", async () => {
    const { storage } = storageWith(createFanficState({ ...request, characters: ["Reader"] }));
    const web: FanficWebResearchGateway = { research: vi.fn() };
    const { llm } = scriptedLlm([]);
    await expect(buildFanficVoiceSheets({ storage, llm, web }, { chatId: "chat-1" })).rejects.toThrow(
      /Name the characters/,
    );
  });
});

describe("voice sheets in the chapter prompt", () => {
  it("adds a Voice Sheets section and drops card example lines for characters with a sheet", () => {
    const state = withFanficVoices(createFanficState(request), [
      sheet("Harlequin", {
        neverSays: ["my dearest"],
        quotes: [{ text: "I'm going to take you from him.", source: "w", url: "https://w.example/h" }],
      }),
    ]);
    const segments = buildFanficSystemSegments({ state, castCards: "", worldInfo: "" });
    const voices = segments.find((segment) => segment.displayName === "Voice Sheets")?.content ?? "";
    expect(voices).toContain("### Harlequin");
    expect(voices).toContain("Never says: my dearest");
    expect(voices).toContain("I'm going to take you from him.");

    const cards = renderFanficCastCards(
      [
        { name: "Harlequin", description: "A jester.", mesExample: "AI-written sample." },
        { name: "Pierrot", description: "A clown.", mesExample: "Pierrot sample." },
      ],
      state.voices,
    );
    expect(cards).not.toContain("AI-written sample.");
    expect(cards).toContain("Pierrot sample.");
  });

  it("survives a round trip through stored metadata and cleans bad entries", () => {
    const state = { ...createFanficState(request), voices: [sheet("Pierrot"), { name: "" }, sheet("pierrot")] };
    expect(readFanficState({ fanfic: state })?.voices?.map((entry) => entry.name)).toEqual(["Pierrot"]);
  });
});

describe("checkFanficChapterVoice", () => {
  const chapter =
    'Harlequin leaned in. "Look at him. He\'s buffering," he said. Pierrot bowed. "Until tomorrow, my dearest."';
  const voiced = withFanficVoices(createFanficState(request), [
    sheet("Harlequin", { neverSays: ["modern slang"] }),
    sheet("Pierrot"),
  ]);
  const messages = [{ id: "m1", role: "assistant", content: chapter }];

  it("grounds lines in the chapter, keeps confirmed ones with their fix, and folds repeats", async () => {
    const { storage } = storageWith(voiced, messages);
    const { llm, requests } = scriptedLlm([
      JSON.stringify({
        issues: [
          {
            character: "harlequin",
            kind: "wording",
            quote: "Look at him. He's buffering,",
            sheetPoint: "Never says: modern slang",
            explanation: "Tech slang.",
            fix: { find: "He's buffering,", replace: "He's stuck like a music box," },
          },
          {
            character: "Harlequin",
            kind: "register",
            quote: "Look at him. He's buffering",
            sheetPoint: "theatrical",
            explanation: "Flat.",
            fix: null,
          },
          {
            character: "Pierrot",
            kind: "wording",
            quote: "Until we meet again, dearest",
            sheetPoint: "",
            explanation: "x",
          },
          {
            character: "Columbina",
            kind: "wording",
            quote: "Until tomorrow, my dearest.",
            sheetPoint: "",
            explanation: "x",
          },
        ],
      }),
      JSON.stringify({
        verdicts: [
          // The second note quoted the same line, so grounding already folded it.
          { note: 1, reason: "Slang.", outOfCharacter: true, sameAs: null },
        ],
      }),
    ]);

    const check = await checkFanficChapterVoice({ storage, llm }, { chatId: "chat-1", messageId: "m1" });

    expect(requests[0]!.messages[0]!.content).toContain("## Voice sheets");
    expect(check.issues).toHaveLength(1);
    expect(check.issues[0]).toMatchObject({ character: "Harlequin", kind: "wording" });
    expect(check.issues[0]!.fix).toEqual({ find: "He's buffering,", replace: "He's stuck like a music box," });
    // Not in the chapter, and a character without a sheet.
    expect(check.ungrounded).toBe(2);
    expect(check.merged).toBe(1);
  });

  it("names the model that ran the voice check, so the fixes it wrote can be credited to it", async () => {
    const { storage } = storageWith(voiced, messages);
    const { llm } = scriptedLlm([JSON.stringify({ issues: [] })]);

    const check = await checkFanficChapterVoice({ storage, llm }, { chatId: "chat-1", messageId: "m1" });

    expect(check.model).toEqual({ connectionId: "conn-1", name: "Checker", model: "check-model" });
  });

  it("asks for voice sheets first", async () => {
    const { storage } = storageWith(createFanficState(request), messages);
    const { llm } = scriptedLlm([]);
    await expect(checkFanficChapterVoice({ storage, llm }, { chatId: "chat-1", messageId: "m1" })).rejects.toThrow(
      /Build the voice sheets first/,
    );
  });

  it("treats a malformed reply as a format error", () => {
    expect(() => parseFanficVoiceCheckReply('{"issues": [{"character": "Pierrot"}]}', ["Pierrot"])).toThrow(
      /no quote or explanation/,
    );
    expect(groundFanficVoiceIssues([], chapter, ["Pierrot"])).toEqual({ grounded: [], dropped: 0, repeats: 0 });
  });
});
