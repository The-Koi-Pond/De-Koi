import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import type { GenerationEvent } from "../../generation/generation-events";
import type { GenerationEngineDeps } from "../../generation/start-generation";

const checks = vi.hoisted(() => ({
  continuity: vi.fn(),
  voice: vi.fn(),
  needsCleanup: vi.fn(() => false),
}));
vi.mock("./continuity", async (importActual) => ({
  ...(await importActual<typeof import("./continuity")>()),
  checkFanficChapterContinuity: checks.continuity,
}));
vi.mock("./voice-check", async (importActual) => ({
  ...(await importActual<typeof import("./voice-check")>()),
  checkFanficChapterVoice: checks.voice,
}));
vi.mock("./ai-isms", async (importActual) => ({
  ...(await importActual<typeof import("./ai-isms")>()),
  fanficAiIsmNeedsCleanup: checks.needsCleanup,
}));

import { fanficChapterTextKey } from "./ledger";
import { polishFanficChapter, readFanficPolishReport } from "./polish";
import { createFanficState, defaultFanficRequest } from "./request";

const CHECKER = { connectionId: "conn-c", name: "Checker", model: "check-model" };
const WRITER = { connectionId: "conn-w", name: "Writer", model: "write-model" };
const ONE = "Crowley parked the Bentley in the snow. The shop was dark.";
const TWO = "Aziraphale lit the stove. Crowley's sunglasses fogged at once, and he swore at the kettle.";

interface Swipe {
  content: string;
  extra: Record<string, unknown>;
}
interface Row {
  id: string;
  swipes: Swipe[];
  active: number;
}

const written = (kind = "chapter") => ({
  fanficVersion: { models: [WRITER], origin: { kind, notes: "" }, unfinished: null },
});

function fic(voices = false): FanficState {
  const state = createFanficState({ ...defaultFanficRequest(), fandom: "Good Omens", characters: ["Crowley"] });
  return {
    ...state,
    outlineApproved: true,
    outline: { title: "Snow", summary: "", chapters: [1, 2].map((n) => ({ number: n, title: `${n}`, summary: "" })) },
    ...(voices
      ? { voices: [{ name: "Crowley", speech: "Drawls.", neverSays: ["golly"], motives: "Comfort.", quotes: [] }] }
      : {}),
  };
}

function storageWith(texts: string[], state = fic()) {
  const rows: Row[] = texts.map((content, index) => ({
    id: `m${index + 1}`,
    swipes: [{ content, extra: written() }],
    active: 0,
  }));
  const view = (row: Row) => ({
    id: row.id,
    chatId: "chat-1",
    role: "assistant",
    content: row.swipes[row.active]!.content,
    extra: row.swipes[row.active]!.extra,
    swipeCount: row.swipes.length,
    activeSwipeIndex: row.active,
  });
  const find = (id: string) => rows.find((row) => row.id === id)!;
  const storage = {
    get: async (_entity: string, id: string) =>
      id === "chat-1" ? { id, mode: "fanfic", metadata: { fanfic: state } } : null,
    listChatMessages: async () => rows.map(view),
    getChatMessage: async (id: string) => view(find(id)),
    addChatMessageSwipe: vi.fn(async (_chat: string, id: string, content: string, options: { extra?: object }) => {
      const row = find(id);
      row.swipes.push({ content, extra: { ...(options.extra ?? {}) } });
      row.active = row.swipes.length - 1;
      return view(row);
    }),
    updateChatMessage: vi.fn(async (id: string, patch: { content: string }) => {
      const row = find(id);
      row.swipes[row.active]!.content = patch.content;
      return view(row);
    }),
    patchChatMessageExtra: async (id: string, patch: object) => {
      const row = find(id);
      row.swipes[row.active]!.extra = { ...row.swipes[row.active]!.extra, ...patch };
      return view(row);
    },
    deleteChatMessageSwipe: vi.fn(async (_chat: string, id: string, index: number) => {
      const row = find(id);
      row.swipes.splice(index, 1);
      row.active = Math.min(row.active, row.swipes.length - 1);
      return view(row);
    }),
  };
  return { storage: storage as unknown as StorageGateway & typeof storage, rows, view: (id: string) => view(find(id)) };
}

/** A clean-up rewrite as the writer does it: streams, then saves a new version (cut off when asked). */
function rewriter(store: ReturnType<typeof storageWith>, text: string, end: "done" | "cut" | "stop" = "done") {
  const notes: string[] = [];
  const rewrite = async function* (note: string): AsyncGenerator<GenerationEvent> {
    notes.push(note);
    yield { type: "phase", data: "Writing…" };
    yield { type: "token", data: text.slice(0, 10) };
    const unfinished =
      end === "cut" ? { reason: "provider_reset", message: "The connection dropped.", code: null } : null;
    const saved = await store.storage.addChatMessageSwipe("chat-1", "m2", text, {
      extra: { fanficVersion: { models: [WRITER], origin: { kind: "revise", notes: note }, unfinished } },
    });
    if (end === "stop") throw new DOMException("The operation was aborted.", "AbortError");
    yield { type: "assistant_message", data: saved };
  };
  return { rewrite, notes };
}

const deps = (storage: StorageGateway) => ({ storage, llm: {} }) as unknown as GenerationEngineDeps;

async function run(
  store: ReturnType<typeof storageWith>,
  rewrite: (notes: string) => AsyncGenerator<GenerationEvent> = rewriter(store, "unused").rewrite,
) {
  const events: GenerationEvent[] = [];
  for await (const event of polishFanficChapter(deps(store.storage), { chatId: "chat-1", messageId: "m2" }, rewrite))
    events.push(event);
  return events;
}

const fixIssue = (find: string, replace: string) => ({ fix: { find, replace } });
const checkResult = (text: string, issues: Array<{ fix: { find: string; replace: string } | null }>) => ({
  textKey: fanficChapterTextKey(text),
  issues,
  model: CHECKER,
});

beforeEach(() => {
  checks.continuity.mockReset().mockImplementation(async () => checkResult(TWO, []));
  checks.voice.mockReset().mockImplementation(async () => checkResult(TWO, []));
  checks.needsCleanup.mockReset().mockReturnValue(false);
});

describe("polishFanficChapter", () => {
  it("leaves a clean chapter as it is and says what it checked", async () => {
    const store = storageWith([ONE, TWO]);

    const events = await run(store);

    expect(store.rows[1]!.swipes).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["phase", "content_replace", "assistant_message"]);
    const report = readFanficPolishReport(store.view("m2").extra, TWO);
    expect(report?.steps.map((step) => `${step.step}:${step.status}`)).toEqual(["prose:clean", "continuity:clean"]);
  });

  it("rewrites AI-sounding prose, then puts the checks' fixes into that same new version", async () => {
    const cleaned = "Aziraphale lit the stove. Crowley's glasses fogged, and he swore at the kettle.";
    const store = storageWith([ONE, TWO], fic(true));
    checks.needsCleanup.mockReturnValue(true);
    checks.continuity.mockImplementation(async () =>
      checkResult(cleaned, [fixIssue("glasses fogged", "sunglasses fogged")]),
    );
    const fixedOnce = "Aziraphale lit the stove. Crowley's sunglasses fogged, and he swore at the kettle.";
    checks.voice.mockImplementation(async () =>
      checkResult(fixedOnce, [fixIssue("swore at the kettle", "told the kettle where to go"), { fix: null }]),
    );
    const { rewrite, notes } = rewriter(store, cleaned);

    const events = await run(store, rewrite);

    expect(notes[0]).toContain("Clean up the prose");
    // The rewrite's own stream and save stay hidden: the reader waits for the polished chapter.
    expect(events.filter((event) => event.type === "token")).toEqual([]);
    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    const chapter = store.rows[1]!;
    expect(chapter.swipes.map((swipe) => swipe.content)).toEqual([
      TWO,
      "Aziraphale lit the stove. Crowley's sunglasses fogged, and he told the kettle where to go.",
    ]);
    expect(store.storage.addChatMessageSwipe).toHaveBeenCalledTimes(1);
    const version = chapter.swipes[1]!.extra.fanficVersion as { models: unknown[] };
    expect(version.models).toEqual([WRITER, CHECKER]);
    const report = readFanficPolishReport(store.view("m2").extra, store.view("m2").content)!;
    expect(report.steps).toEqual([
      { step: "prose", status: "fixed", fixed: 1, left: 0, error: null },
      { step: "continuity", status: "fixed", fixed: 1, left: 0, error: null },
      { step: "voice", status: "fixed", fixed: 1, left: 1, error: null },
    ]);
  });

  it("saves fixes as a new version when the prose needed no clean-up, keeping the chapter as written", async () => {
    const store = storageWith([ONE, TWO]);
    checks.continuity.mockImplementation(async () => checkResult(TWO, [fixIssue("at once", "in a moment")]));

    await run(store);

    expect(store.rows[1]!.swipes.map((swipe) => swipe.content)).toEqual([TWO, TWO.replace("at once", "in a moment")]);
    expect(store.rows[1]!.active).toBe(1);
  });

  it("notes a check that failed and still runs the next one", async () => {
    const store = storageWith([ONE, TWO], fic(true));
    checks.continuity.mockRejectedValue(new Error("The judge's reply couldn't be read."));

    await run(store);

    expect(checks.voice).toHaveBeenCalled();
    const report = readFanficPolishReport(store.view("m2").extra, TWO)!;
    expect(report.steps[1]).toEqual({
      step: "continuity",
      status: "failed",
      fixed: 0,
      left: 0,
      error: "The judge's reply couldn't be read.",
    });
  });

  it("drops a clean-up that was cut off and checks the chapter as written", async () => {
    const store = storageWith([ONE, TWO]);
    checks.needsCleanup.mockReturnValue(true);

    await run(store, rewriter(store, "Aziraphale lit the", "cut").rewrite);

    expect(store.rows[1]!.swipes.map((swipe) => swipe.content)).toEqual([TWO]);
    expect(checks.continuity).toHaveBeenCalled();
    const report = readFanficPolishReport(store.view("m2").extra, TWO)!;
    expect(report.steps[0]).toMatchObject({ step: "prose", status: "failed", error: "The connection dropped." });
  });

  it("on a Stop, removes the half-made version and stops", async () => {
    const store = storageWith([ONE, TWO]);
    checks.needsCleanup.mockReturnValue(true);

    await expect(run(store, rewriter(store, "Aziraphale lit", "stop").rewrite)).rejects.toThrow("aborted");

    expect(store.rows[1]!.swipes.map((swipe) => swipe.content)).toEqual([TWO]);
    expect(checks.continuity).not.toHaveBeenCalled();
    expect(store.view("m2").extra.fanficPolish).toBeUndefined();
  });

  it("skips the continuity check for a first chapter", async () => {
    const store = storageWith([ONE]);
    const events: GenerationEvent[] = [];
    for await (const event of polishFanficChapter(
      deps(store.storage),
      { chatId: "chat-1", messageId: "m1" },
      rewriter(store, "x").rewrite,
    ))
      events.push(event);

    expect(checks.continuity).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["content_replace", "assistant_message"]);
  });

  it("refuses an unfinished chapter", async () => {
    const store = storageWith([ONE, TWO]);
    store.rows[1]!.swipes[0]!.extra = {
      fanficVersion: { models: [], origin: { kind: "chapter", notes: "" }, unfinished: { reason: "length" } },
    };

    await expect(run(store)).rejects.toThrow("unfinished");
  });
});

describe("readFanficPolishReport", () => {
  it("stops showing once the chapter's text is edited", () => {
    const extra = { fanficPolish: { textKey: fanficChapterTextKey(TWO), steps: [] } };
    expect(readFanficPolishReport(extra, TWO)).toEqual({ textKey: fanficChapterTextKey(TWO), steps: [] });
    expect(readFanficPolishReport(extra, `${TWO} More.`)).toBeNull();
  });
});
