// The recorder's extra fakes for the AI Review tab (test-fixtures/README.md, "Extra fakes"), on top of the Overview
// fakes: `storageApi.promptFull`, `llmApi`, a scripted `reviewPromptPreset` and the scripted streams. Every call goes
// into the Overview fakes' log, so the order across both matches the recordings. It imports no app module that the
// spec files mock, so `vi.mock` factories can load it.
import { ApiError } from "../../../../../shared/api/api-errors";
import { fakePresetOverviewApis, fakeStorageApi } from "../preset-overview/fake-preset-overview-apis";

/** The ops these fakes own (the rest are the Overview fakes'). */
export const REVIEW_OPS = ["prompts.full"] as const;
type ReviewOp = (typeof REVIEW_OPS)[number];

type Reviewer = (...args: unknown[]) => AsyncIterable<unknown>;

const copy = <T>(value: T): T => structuredClone(value);

type StreamItem = { kind: "yield"; value: unknown } | { kind: "throw"; value: unknown } | { kind: "end" };

/** An async stream that waits until the test gives it an item: yield a value, throw a value, or end. */
class ScriptedStream implements AsyncIterableIterator<unknown> {
  private readonly items: StreamItem[] = [];
  private wake: (() => void) | null = null;
  ended = false;

  give(item: StreamItem) {
    if (this.ended) return;
    if (item.kind !== "yield") this.ended = true;
    this.items.push(item);
    this.wake?.();
  }

  async next(): Promise<IteratorResult<unknown>> {
    while (this.items.length === 0) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
    this.wake = null;
    const item = this.items.shift()!;
    if (item.kind === "end") return { done: true, value: undefined };
    if (item.kind === "throw") throw item.value;
    return { done: false, value: item.value };
  }

  /** Called when the reader stops early (a `for await` that threw or broke). */
  async return(): Promise<IteratorResult<unknown>> {
    this.ended = true;
    this.items.length = 0;
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

const state = {
  streams: [] as ScriptedStream[],
  realMode: false,
  realReviewer: null as Reviewer | null,
  failures: new Map<ReviewOp, string>(),
  held: new Set<ReviewOp>(),
  waiting: new Map<ReviewOp, Array<() => void>>(),
  /** The abort signals given to the reviewer and to the model stream, in call order (undefined when none). */
  signals: [] as Array<{ to: "review" | "llm.stream"; signal: AbortSignal | undefined }>,
};

function newStream(): ScriptedStream {
  const stream = new ScriptedStream();
  state.streams.push(stream);
  return stream;
}

/** Stream `n`, or the newest one. */
function streamAt(n?: number): ScriptedStream | undefined {
  return n === undefined ? state.streams.at(-1) : state.streams[n];
}

async function gate(op: ReviewOp) {
  if (state.held.has(op)) {
    await new Promise<void>((resolve) => {
      state.waiting.set(op, [...(state.waiting.get(op) ?? []), resolve]);
    });
  }
  const failure = state.failures.get(op);
  if (failure !== undefined) {
    state.failures.delete(op);
    throw new Error(failure);
  }
}

/** What `throwReview` throws (README, "Extra steps"). */
export type ThrowSpec = { error: string } | { apiError: [string, number] } | { abort: true } | { raw: unknown };

function thrown(spec: ThrowSpec): unknown {
  if ("error" in spec) return new Error(spec.error);
  if ("apiError" in spec) return new ApiError(spec.apiError[0], spec.apiError[1]);
  if ("abort" in spec) return new DOMException("The operation was aborted.", "AbortError");
  return spec.raw;
}

export const fakePresetReviewApis = {
  reset() {
    state.streams = [];
    state.realMode = false;
    state.failures.clear();
    state.held.clear();
    state.waiting.clear();
    state.signals = [];
  },
  /** The abort signals the reviewer and the model stream were given, in call order. */
  signals() {
    return state.signals;
  },
  /** Gives the fake reviewer the real one, for `realMode` steps. */
  setRealReviewer(reviewer: Reviewer) {
    state.realReviewer = reviewer;
  },
  /** Later reviewer calls run the real reviewer over these fakes. */
  useRealReviewer() {
    state.realMode = true;
  },
  failNext(op: ReviewOp, message: string) {
    state.failures.set(op, message);
  },
  hold(op: ReviewOp) {
    state.held.add(op);
  },
  release(op: ReviewOp) {
    state.held.delete(op);
    const waiting = state.waiting.get(op) ?? [];
    state.waiting.delete(op);
    for (const resume of waiting) resume();
  },
  releaseAll() {
    for (const op of [...state.held, ...state.waiting.keys()]) this.release(op);
  },
  emit(value: unknown, n?: number) {
    streamAt(n)?.give({ kind: "yield", value });
  },
  end(n?: number) {
    streamAt(n)?.give({ kind: "end" });
  },
  throwNewest(spec: ThrowSpec) {
    streamAt()?.give({ kind: "throw", value: thrown(spec) });
  },
};

/** Stands in for `storageApi`: the Overview fakes plus `promptFull`. */
export const fakeReviewStorageApi = {
  ...fakeStorageApi,
  async promptFull(presetId: string) {
    fakePresetOverviewApis.logCall(["storage.promptFull", presetId]);
    await gate("prompts.full");
    const stored = fakePresetOverviewApis.stored();
    const preset = stored.presets.find((row) => row.id === presetId);
    if (!preset) return null;
    const ofPreset = (rows: Array<Record<string, unknown>>) => rows.filter((row) => row.presetId === presetId);
    return {
      preset,
      sections: ofPreset(stored.sections),
      groups: ofPreset(stored.groups),
      choiceBlocks: ofPreset(stored.variables),
    };
  },
};

/** Stands in for `llmApi`: `stream` gives a scripted stream; `complete` is never called. */
export const fakeLlmApi = {
  stream(request: unknown, signal?: AbortSignal) {
    state.signals.push({ to: "llm.stream", signal });
    fakePresetOverviewApis.logCall(["llm.stream", copy(request), signal === undefined ? null : "signal"]);
    return newStream();
  },
  async complete(request: unknown): Promise<never> {
    fakePresetOverviewApis.logCall(["llm.complete", copy(request)]);
    throw new Error("llmApi.complete is not part of the recordings");
  },
};

/**
 * Stands in for `reviewPromptPreset`: notes how it was called (whether the capabilities are these exact fakes), then
 * gives a scripted stream, or after `useRealReviewer` runs the real reviewer with the same arguments.
 */
export function fakeReviewPromptPreset(
  capabilities: { storage?: unknown; llm?: unknown },
  input: unknown,
  ...extra: unknown[]
): AsyncIterable<unknown> {
  fakePresetOverviewApis.logCall([
    "review",
    {
      keys: Object.keys(capabilities),
      storageIsStorageApi: capabilities.storage === fakeReviewStorageApi,
      llmIsLlmApi: capabilities.llm === fakeLlmApi,
    },
    copy(input),
    extra.length,
  ]);
  state.signals.push({ to: "review", signal: extra[0] as AbortSignal | undefined });
  if (!state.realMode) return newStream();
  if (!state.realReviewer) throw new Error("fakePresetReviewApis.setRealReviewer() was not called");
  return state.realReviewer(capabilities, input, ...extra);
}
