import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import { filterAgentIdsForChatMode } from "../../contracts/types/agent";
import { getEffectiveMemoryRecallEnabled } from "../../contracts/types/chat";
import type { TranceRequest, TranceState } from "../../contracts/types/trance";
import { buildTranceRequestPrompt, buildTranceSystemPrompt } from "./prompts";
import {
  createTranceState,
  defaultTranceRequest,
  normalizeTranceRequest,
  readTranceState,
  tranceEstimatedMinutes,
  tranceStage,
  tranceTargetLines,
  withTranceRun,
  TRANCE_RUN_LIMIT,
} from "./request";
import { generateTranceScript, parseTranceReply, splitTranceLine, TranceScriptParseError } from "./script";
import { recordTranceRun, saveTranceRequest, tranceButtonLabel } from "./session";

function lines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}.`).join("\n");
}

function reply(options: { ending?: "wake" | "sleep"; main?: number; skip?: string[] } = {}): string {
  const ending = options.ending ?? "wake";
  const main = options.main ?? 20;
  const skip = new Set(options.skip ?? []);
  const sections: Array<[string, string]> = [
    ["## pretalk", lines("Hello there", 3)],
    ["## induction", lines("Breathe and read", main)],
    ["## deepener", lines("Deeper now", main)],
    ["## suggestions", lines("So good", main)],
    [`## ${ending}`, lines(ending === "wake" ? "Waking" : "Sleeping", 10)],
    ["## exit: gentle", lines("Coming up", 5)],
    ["## exit: calm", lines("You are safe", 6)],
  ];
  return sections
    .filter(([heading]) => !skip.has(heading))
    .map(([heading, body]) => `${heading}\n${body}`)
    .join("\n\n");
}

describe("trance request", () => {
  it("normalizes unknown values to defaults and keeps sexual features out of gentle sessions", () => {
    const request = normalizeTranceRequest({
      type: "gentle",
      category: "nope",
      features: ["fractionation", "arousal", "orgasm", "made-up"],
      mood: "anxious",
      minutes: 7,
      ending: "sleep",
      idea: "x".repeat(2000),
    });
    expect(request.category).toBe("relax");
    expect(request.features).toEqual(["fractionation"]);
    expect(request.mood).toBe("anxious");
    expect(request.minutes).toBe(10);
    expect(request.ending).toBe("sleep");
    expect(request.idea.length).toBe(600);
  });

  it("keeps sexual features for erotic and kinky sessions", () => {
    expect(normalizeTranceRequest({ type: "kinky", features: ["orgasm", "obedience"] }).features).toEqual([
      "obedience",
      "orgasm",
    ]);
  });

  it("reads stored state and reports the stage", () => {
    expect(readTranceState({})).toBeNull();
    expect(tranceStage(null)).toBe("request");
    const state = createTranceState(defaultTranceRequest());
    expect(tranceStage(readTranceState({ trance: state }))).toBe("script");
    const withScript = {
      ...state,
      script: {
        lines: [{ phase: "induction", text: "Hi" }],
        exits: { gentle: [], calm: [] },
        connectionId: "c",
        createdAt: "t",
      },
    };
    expect(tranceStage(readTranceState({ trance: withScript }))).toBe("ready");
  });

  it("maps minutes to lines and back", () => {
    expect(tranceTargetLines(10)).toBe(100);
    expect(tranceEstimatedMinutes(100)).toBe(10);
    expect(tranceEstimatedMinutes(3)).toBe(1);
  });

  it("keeps runs newest first and capped", () => {
    let state = createTranceState(defaultTranceRequest());
    for (let index = 0; index < TRANCE_RUN_LIMIT + 3; index += 1) {
      state = withTranceRun(state, {
        finishedBy: "completed",
        rating: 7,
        fullyAwake: true,
        note: `${index}`,
        seconds: 600,
        at: `${index}`,
      });
    }
    expect(state.runs).toHaveLength(TRANCE_RUN_LIMIT);
    expect(state.runs[0]!.note).toBe(`${TRANCE_RUN_LIMIT + 2}`);
  });

  it("drops out-of-range ratings", () => {
    const state = withTranceRun(createTranceState(defaultTranceRequest()), {
      finishedBy: "stop",
      rating: 11,
      fullyAwake: null,
      note: "",
      seconds: null,
      at: "t",
    });
    expect(state.runs[0]!.rating).toBeNull();
  });
});

describe("trance mode gates", () => {
  it("runs no agents and no memory recall", () => {
    expect([...filterAgentIdsForChatMode(["world-state", "expression"], "trance")]).toEqual([]);
    expect(getEffectiveMemoryRecallEnabled("trance", { enableMemoryRecall: true })).toBe(false);
  });
});

describe("trance prompt", () => {
  const request: TranceRequest = {
    ...defaultTranceRequest(),
    type: "kinky",
    features: ["obedience"],
    mood: "anxious",
    moodNote: "long day",
    idea: "a puppet in a box",
  };

  it("carries the hypnotist rules and the exits", () => {
    const system = buildTranceSystemPrompt();
    expect(system).toMatch(/any of it is right/);
    expect(system).toMatch(/wandering mind/);
    expect(system).toMatch(/Never mention buttons, exits/);
    expect(system).toMatch(/both outcomes/);
    expect(system).toMatch(/## exit: gentle/);
    expect(system).toMatch(/## exit: calm/);
    expect(system).not.toMatch(/<[a-z]+>/);
  });

  it("puts the character, mood, idea and length in the request", () => {
    const prompt = buildTranceRequestPrompt(request, { name: "Jester", description: "{{char}} teases {{user}}." });
    expect(prompt).toMatch(/### Jester/);
    expect(prompt).toMatch(/Jester teases the listener\./);
    expect(prompt).toMatch(/anxious/);
    expect(prompt).toMatch(/In their words: long day/);
    expect(prompt).toMatch(/a puppet in a box/);
    expect(prompt).toMatch(/about 100 lines/);
    expect(prompt).toMatch(/Obedience/);
  });
});

describe("parseTranceReply", () => {
  it("reads sections in order and keeps exits apart", () => {
    const parsed = parseTranceReply(reply(), "wake");
    expect(parsed.lines[0]).toEqual({ phase: "pretalk", text: "Hello there 1." });
    expect(parsed.lines.at(-1)).toEqual({ phase: "wake", text: "Waking 10." });
    expect(parsed.lines).toHaveLength(3 + 60 + 10);
    expect(parsed.exits.gentle).toHaveLength(5);
    expect(parsed.exits.calm).toHaveLength(6);
  });

  it("cleans bullets, numbers and quotes and tolerates heading variants", () => {
    const raw = reply().replace("## induction\n", "### Induction:\n- “Look at the words.”\n2) Breathe.\n");
    const parsed = parseTranceReply(raw, "wake");
    const induction = parsed.lines.filter((line) => line.phase === "induction").map((line) => line.text);
    expect(induction.slice(0, 2)).toEqual(["Look at the words.", "Breathe."]);
  });

  it("fails on a missing section, the wrong ending, or missing exits", () => {
    expect(() => parseTranceReply(reply({ skip: ["## deepener"] }), "wake")).toThrow(TranceScriptParseError);
    expect(() => parseTranceReply(reply({ ending: "sleep" }), "wake")).toThrow(/ended with sleep instead of wake/);
    expect(() => parseTranceReply(reply({ skip: ["## exit: calm"] }), "wake")).toThrow(/no calm exit/);
  });

  it("splits long lines at sentence ends only", () => {
    const long = `${"Breathe in slowly and feel it. ".repeat(6)}And out.`;
    const parts = splitTranceLine(long.trim());
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 140)).toBe(true);
    const oneSentence = "word ".repeat(40).trim();
    expect(splitTranceLine(oneSentence)).toEqual([oneSentence]);
  });
});

describe("tranceButtonLabel", () => {
  it("follows the phase and never repeats the previous word", () => {
    expect(["Slowly waking", "More aware", "Almost awake", "Feeling brighter"]).toContain(
      tranceButtonLabel("wake", "3...", null),
    );
    let previous: string | null = null;
    for (const text of ["a", "b", "c", "d", "e", "f", "g"]) {
      const label = tranceButtonLabel("deepener", text, previous);
      expect(label).not.toBe(previous);
      previous = label;
    }
    expect(tranceButtonLabel("induction", "same", null)).toBe(tranceButtonLabel("induction", "same", null));
  });
});

function storageFor(state: TranceState | null, chat: Record<string, unknown> = {}) {
  const chats = new Map<string, Record<string, unknown>>([
    [
      "s1",
      {
        id: "s1",
        mode: "trance",
        connectionId: "conn",
        characterIds: ["jester"],
        metadata: state ? { trance: state } : {},
        ...chat,
      },
    ],
  ]);
  const patches: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "characters" && id === "jester")
        return { id, data: { name: "Jester", description: "A clown." } } as T;
      return null;
    },
    async update(entity: StorageEntity, id: string, value: Record<string, unknown>) {
      updates.push(value);
      if (entity === "chats") chats.set(id, { ...chats.get(id), ...value });
      return chats.get(id);
    },
    async patchChatMetadata(id: string, patch: Record<string, unknown>) {
      patches.push(patch);
      const row = chats.get(id)!;
      chats.set(id, { ...row, metadata: { ...(row.metadata as object), ...patch } });
    },
  } as unknown as StorageGateway;
  return { storage, chats, patches, updates };
}

function llmReplying(...replies: string[]) {
  const complete = vi.fn(async () => replies.shift() ?? "");
  return { llm: { complete } as unknown as LlmGateway, complete };
}

describe("generateTranceScript", () => {
  const state = createTranceState(defaultTranceRequest());

  it("writes and stores the script in the character's voice", async () => {
    const { storage, patches } = storageFor(state);
    const { llm, complete } = llmReplying(reply({ main: 30 }));
    const next = await generateTranceScript({ storage, llm }, "s1", { now: () => new Date("2026-11-12T00:00:00Z") });
    expect(complete).toHaveBeenCalledOnce();
    const sent = (
      complete.mock.calls[0] as unknown as [{ messages: Array<{ content: string }>; connectionId: string }]
    )[0];
    expect(sent.connectionId).toBe("conn");
    expect(sent.messages[1]!.content).toMatch(/### Jester/);
    expect(next.script?.lines.length).toBe(3 + 90 + 10);
    expect(next.script?.createdAt).toBe("2026-11-12T00:00:00.000Z");
    expect(patches).toHaveLength(1);
  });

  it("retries once on a broken reply, then fails with what was wrong", async () => {
    const { storage } = storageFor(state);
    const ok = llmReplying("no headings at all", reply({ main: 30 }));
    await expect(generateTranceScript({ storage, llm: ok.llm }, "s1")).resolves.toBeTruthy();
    expect(ok.complete).toHaveBeenCalledTimes(2);

    const bad = llmReplying("nope", "still nope");
    await expect(generateTranceScript({ storage, llm: bad.llm }, "s1")).rejects.toThrow(/no induction section/);
  });

  it("asks again when far too short and keeps the longer script", async () => {
    const { storage } = storageFor(state);
    const { llm, complete } = llmReplying(reply({ main: 5 }), reply({ main: 30 }));
    const next = await generateTranceScript({ storage, llm }, "s1");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(next.script?.lines.length).toBe(3 + 90 + 10);
  });

  it("keeps a short script when the retry is no better, showing its real length", async () => {
    const { storage } = storageFor(state);
    const { llm } = llmReplying(reply({ main: 5 }), "broken");
    const next = await generateTranceScript({ storage, llm }, "s1");
    expect(next.script?.lines.length).toBe(3 + 15 + 10);
  });

  it("says what's missing before calling the model", async () => {
    const noConnection = storageFor(state, { connectionId: null });
    const noCharacter = storageFor(state, { characterIds: [] });
    const { llm, complete } = llmReplying();
    await expect(generateTranceScript({ storage: noConnection.storage, llm }, "s1")).rejects.toThrow(
      /model connection/,
    );
    await expect(generateTranceScript({ storage: noCharacter.storage, llm }, "s1")).rejects.toThrow(/character/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("drops the reply when stopped", async () => {
    const { storage, patches } = storageFor(state);
    const controller = new AbortController();
    const llm = {
      complete: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve(reply()), 10);
          }),
      ),
    } as unknown as LlmGateway;
    const run = generateTranceScript({ storage, llm }, "s1", { signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toThrow(/aborted/);
    expect(patches).toHaveLength(0);
  });
});

describe("saving requests and runs", () => {
  it("saves the connection, character and a fresh request, keeping past runs", async () => {
    const old = withTranceRun(createTranceState(defaultTranceRequest()), {
      finishedBy: "completed",
      rating: 8,
      fullyAwake: true,
      note: "",
      seconds: null,
      at: "t",
    });
    const { storage, chats } = storageFor(old);
    const saved = await saveTranceRequest(storage, {
      chatId: "s1",
      request: { ...defaultTranceRequest(), minutes: 20 },
      connectionId: "other",
      characterId: "jester",
    });
    expect(saved.script).toBeNull();
    expect(saved.runs).toHaveLength(1);
    expect(chats.get("s1")!.connectionId).toBe("other");
    expect(chats.get("s1")!.characterIds).toEqual(["jester"]);
    expect(chats.get("s1")!.name).toBe("Jester - Trance");
  });

  it("leaves a name the person chose", async () => {
    const { storage, chats } = storageFor(null, { name: "Bedtime" });
    await saveTranceRequest(storage, {
      chatId: "s1",
      request: defaultTranceRequest(),
      connectionId: "c",
      characterId: "jester",
    });
    expect(chats.get("s1")!.name).toBe("Bedtime");
  });

  it("puts the connection and character back when the request write fails", async () => {
    const { storage, chats } = storageFor(null);
    (storage as unknown as { patchChatMetadata: () => Promise<void> }).patchChatMetadata = async () => {
      throw new Error("disk full");
    };
    await expect(
      saveTranceRequest(storage, {
        chatId: "s1",
        request: defaultTranceRequest(),
        connectionId: "other",
        characterId: "x",
      }),
    ).rejects.toThrow("disk full");
    expect(chats.get("s1")!.connectionId).toBe("conn");
    expect(chats.get("s1")!.characterIds).toEqual(["jester"]);
  });

  it("records a run on the stored state", async () => {
    const { storage } = storageFor(createTranceState(defaultTranceRequest()));
    const next = await recordTranceRun(storage, "s1", {
      finishedBy: "calm",
      rating: 4,
      fullyAwake: false,
      note: "felt odd",
      seconds: 540,
      at: "t",
    });
    expect(next.runs[0]).toMatchObject({
      finishedBy: "calm",
      rating: 4,
      fullyAwake: false,
      note: "felt odd",
      seconds: 540,
    });
  });
});
