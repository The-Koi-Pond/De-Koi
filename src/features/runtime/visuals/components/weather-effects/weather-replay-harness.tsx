// ──────────────────────────────────────────────
// Test harness: replay recorded weather scenarios against the component in jsdom
// (format in test-fixtures/README.md)
// ──────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { WeatherEffects } from "./index";

export type Op = [string, ...unknown[]];
type RecordedOp = Op | { repeat: number; ops: Op[] };

interface Props {
  weather?: string | null;
  timeOfDay?: string | null;
  showCelestial?: boolean;
}

type Step =
  | ["mount"]
  | ["frame", number]
  | ["frames", number, number, number[]]
  | ["resize", number, number]
  | ["ro", number, number]
  | ["hide"]
  | ["show"]
  | ["props", Partial<Props>]
  | ["unmount"];

interface Listeners {
  windowAdd: number;
  windowRemove: number;
  docAdd: number;
  docRemove: number;
}

export interface RecordedStep {
  step: Step;
  ran?: boolean;
  html: string;
  size: [number, number] | null;
  events: unknown[][] | number;
  ops?: RecordedOp[];
  counts?: number[];
  logged?: { index: number; ts: number; ops: RecordedOp[] }[];
  listeners?: Listeners;
}

export interface Scenario {
  id: string;
  props: Props;
  random: number | { seed: number };
  rect?: [number | null, number | null];
  inner?: [number, number];
  dpr?: number;
  hiddenAtStart?: boolean;
  steps: RecordedStep[];
}

export interface ReplayedStep extends Omit<RecordedStep, "ops" | "logged"> {
  ops?: Op[];
  logged?: { index: number; ts: number; ops: Op[] }[];
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "test-fixtures");

export function loadScenarios(file: string): Scenario[] {
  const parsed = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as { format: number; scenarios: Scenario[] };
  if (parsed.format !== 1) throw new Error(`${file}: unknown format ${parsed.format}`);
  return parsed.scenarios;
}

export function expandOps(ops: RecordedOp[]): Op[] {
  return ops.flatMap((op) => (Array.isArray(op) ? [op] : Array.from({ length: op.repeat }, () => op.ops).flat()));
}

/** mulberry32, the generator the seeded recordings used. */
export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTEXT_PROPERTIES = new Set([
  "fillStyle",
  "strokeStyle",
  "lineWidth",
  "globalAlpha",
  "globalCompositeOperation",
]);

/**
 * A 2D context that logs every call and property set. Gradients are named g0, g1, … in creation order,
 * starting again at g0 after each `globalAlpha = 1` and at the start of each logged step or frame.
 */
function createLoggingContext(ops: Op[]): { context: CanvasRenderingContext2D; restartGradientNames: () => void } {
  const values: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
  let gradientCount = 0;
  const gradientNames = new WeakMap<object, string>();
  const logged = (value: unknown) =>
    typeof value === "object" && value !== null ? (gradientNames.get(value) ?? "[object]") : value;

  const createGradient = (kind: string, args: unknown[]) => {
    const name = `g${gradientCount++}`;
    ops.push([kind, name, ...args]);
    const gradient = {
      addColorStop: (offset: number, color: string) => ops.push(["addColorStop", name, offset, color]),
    };
    gradientNames.set(gradient, name);
    return gradient;
  };

  const context = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (CONTEXT_PROPERTIES.has(prop)) return values[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return (...args: unknown[]) => createGradient(prop, args);
      }
      return (...args: unknown[]) => {
        ops.push([prop, ...args]);
      };
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return false;
      values[prop] = value;
      ops.push([`=${prop}`, logged(value)]);
      if (prop === "globalAlpha" && value === 1) gradientCount = 0;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    context,
    restartGradientNames: () => {
      gradientCount = 0;
    },
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setWindowValue(name: "innerWidth" | "innerHeight" | "devicePixelRatio", value: number) {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

function readHtml(container: HTMLElement) {
  return container.innerHTML.replace(/ (width|height)="[^"]*"/g, "");
}

/** Render a scenario's props and replay its steps, returning what the component did at each one. */
export async function replayScenario(
  scenario: Scenario,
  onStep?: (step: ReplayedStep, index: number) => void,
): Promise<ReplayedStep[]> {
  const ops: Op[] = [];
  const events: unknown[][] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  // A null side in the recording stands for a non-number (NaN) size.
  let rect = scenario.rect
    ? { width: scenario.rect[0] ?? NaN, height: scenario.rect[1] ?? NaN }
    : { width: 640, height: 360 };
  let hidden = scenario.hiddenAtStart ?? false;
  const observers = new Set<FakeResizeObserver>();

  class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {
      events.push(["ro:new"]);
    }
    observe(target: Element) {
      events.push(["ro:observe", target.tagName.toLowerCase()]);
      observers.add(this);
    }
    unobserve() {}
    disconnect() {
      events.push(["ro:disconnect"]);
      observers.delete(this);
    }
    trigger() {
      this.callback([], this as unknown as ResizeObserver);
    }
  }

  const { context, restartGradientNames } = createLoggingContext(ops);
  const originals = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
  setWindowValue("innerWidth", scenario.inner?.[0] ?? 1366);
  setWindowValue("innerHeight", scenario.inner?.[1] ?? 900);
  setWindowValue("devicePixelRatio", scenario.dpr ?? 1);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  if (typeof scenario.random === "number") vi.spyOn(Math, "random").mockReturnValue(scenario.random);
  else vi.spyOn(Math, "random").mockImplementation(mulberry32(scenario.random.seed));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    events.push(["getContext"]);
    return context;
  }) as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({ ...rect, x: 0, y: 0, top: 0, left: 0, right: rect.width, bottom: rect.height, toJSON: () => ({}) }) as DOMRect,
  );
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    events.push(["raf", id]);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
    events.push(["cancel", id]);
  });
  // Pass-through spies; matching calls are counted at unmount.
  const listenerSpies = {
    windowAdd: vi.spyOn(window, "addEventListener"),
    windowRemove: vi.spyOn(window, "removeEventListener"),
    docAdd: vi.spyOn(document, "addEventListener"),
    docRemove: vi.spyOn(document, "removeEventListener"),
  };
  const countListeners = (): Listeners => {
    const count = (spy: { mock: { calls: unknown[][] } }, type: string) =>
      spy.mock.calls.filter(([eventType]) => eventType === type).length;
    return {
      windowAdd: count(listenerSpies.windowAdd, "resize"),
      windowRemove: count(listenerSpies.windowRemove, "resize"),
      docAdd: count(listenerSpies.docAdd, "visibilitychange"),
      docRemove: count(listenerSpies.docRemove, "visibilitychange"),
    };
  };

  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | null = createRoot(container);
  let props: Props = { ...scenario.props };
  let lastFrameTs = 0;
  const results: ReplayedStep[] = [];

  const runFrame = (ts: number): boolean => {
    lastFrameTs = ts;
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) return false;
    frames.delete(next[0]);
    restartGradientNames();
    next[1](ts);
    return true;
  };

  try {
    for (const [index, recorded] of scenario.steps.entries()) {
      ops.length = 0;
      events.length = 0;
      restartGradientNames();
      const step = recorded.step;
      const out: ReplayedStep = { step, html: "", size: null, events: [] };

      switch (step[0]) {
        case "mount":
          await act(async () => root?.render(<WeatherEffects {...props} />));
          break;
        case "frame":
          out.ran = runFrame(step[1]);
          break;
        case "frames": {
          const [, count, spacing, loggedIndexes] = step;
          const base = lastFrameTs;
          const counts: number[] = [];
          const logged: { index: number; ts: number; ops: Op[] }[] = [];
          for (let i = 0; i < count; i++) {
            const ts = base + spacing * (i + 1);
            const before = ops.length;
            const ran = runFrame(ts);
            counts.push(ran ? ops.length - before : -1);
            if (loggedIndexes.includes(i)) logged.push({ index: i, ts, ops: ops.slice(before) });
          }
          out.counts = counts;
          out.logged = logged;
          break;
        }
        case "resize":
          rect = { width: step[1], height: step[2] };
          act(() => window.dispatchEvent(new Event("resize")));
          break;
        case "ro":
          rect = { width: step[1], height: step[2] };
          act(() => [...observers].forEach((observer) => observer.trigger()));
          break;
        case "hide":
        case "show":
          hidden = step[0] === "hide";
          act(() => document.dispatchEvent(new Event("visibilitychange")));
          break;
        case "props":
          props = { ...props, ...step[1] };
          await act(async () => root?.render(<WeatherEffects {...props} />));
          break;
        case "unmount":
          act(() => root?.unmount());
          root = null;
          out.listeners = countListeners();
          break;
      }

      const canvas = container.querySelector("canvas");
      out.html = readHtml(container);
      out.size = canvas ? [canvas.width, canvas.height] : null;
      if (step[0] === "frames") out.events = events.length;
      else {
        out.events = events.map((event) => [...event]);
        out.ops = ops.slice();
      }
      results.push(out);
      onStep?.(out, index);
    }
  } finally {
    if (root) act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setWindowValue("innerWidth", originals.innerWidth);
    setWindowValue("innerHeight", originals.innerHeight);
    setWindowValue("devicePixelRatio", originals.devicePixelRatio);
  }
  return results;
}

function closeEnough(actual: number, expected: number) {
  return Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-6);
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") return closeEnough(actual, expected);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, i) => sameValue(actual[i], item))
    );
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null) return false;
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].every((key) =>
      sameValue((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]),
    );
  }
  return actual === expected;
}

/** The first difference between two op lists, or null when they match. */
export function diffOps(actual: Op[], expected: Op[]): string | null {
  const length = Math.max(actual.length, expected.length);
  for (let i = 0; i < length; i++) {
    if (!sameValue(actual[i], expected[i])) {
      const around = (list: Op[]) => JSON.stringify(list.slice(Math.max(0, i - 2), i + 3));
      return `op ${i} of ${expected.length} (got ${actual.length}): expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}\n  expected near: ${around(expected)}\n  got near:      ${around(actual)}`;
    }
  }
  return null;
}

/** Every difference between a replayed step and its recording, as readable lines. */
export function diffStep(actual: ReplayedStep, expected: RecordedStep): string[] {
  const problems: string[] = [];
  const check = (field: string, got: unknown, want: unknown) => {
    if (!sameValue(got, want)) problems.push(`${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  check("html", actual.html, expected.html);
  check("size", actual.size, expected.size);
  check("events", actual.events, expected.events);
  if ("ran" in expected) check("ran", actual.ran, expected.ran);
  if (expected.listeners) check("listeners", actual.listeners, expected.listeners);
  if (expected.ops) {
    const diff = diffOps(actual.ops ?? [], expandOps(expected.ops));
    if (diff) problems.push(`ops: ${diff}`);
  }
  if (expected.counts) check("counts", actual.counts, expected.counts);
  if (expected.logged) {
    check(
      "logged indexes",
      actual.logged?.map(({ index, ts }) => [index, ts]),
      expected.logged.map(({ index, ts }) => [index, ts]),
    );
    for (const want of expected.logged) {
      const got = actual.logged?.find((entry) => entry.index === want.index);
      const diff = diffOps(got?.ops ?? [], expandOps(want.ops));
      if (diff) problems.push(`logged frame ${want.index}: ${diff}`);
    }
  }
  return problems.map((problem) => `${JSON.stringify(expected.step)} ${problem}`);
}
