// Replays the black-box recordings (test-fixtures/README.md) against the widget: the recorder's fake picture loading,
// pointer-capture stub, caller, actions and snapshot, with the parts found by the widget's test hooks.
import { act, Component, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AvatarCropWidget } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Recording types ─────────────────────────────────────────────────────────────────────────────────────────

type Part = "box" | "tl" | "tr" | "bl" | "br";
type ImgState = { state: "pending" | "loaded" | "broken"; w: number; h: number };

type Action =
  | { do: "load"; src: string }
  | { do: "loadSilent"; src: string }
  | { do: "break"; src: string }
  | { do: "rerender" }
  | { do: "props"; src?: string; alt?: string; crop?: unknown }
  | { do: "down"; on: Part; x: number; y: number; id?: number; button?: number }
  | { do: "move"; x: number; y: number; id?: number }
  | { do: "moveOn"; on: Part; x: number; y: number; id?: number }
  | { do: "up"; x?: number; y?: number; id?: number }
  | { do: "cancel"; id?: number }
  | { do: "click"; name: "Full image" | "Reset" | "closeFull" | "fullBackdrop" | "fullImage" | "box" | "heading" }
  | { do: "key"; key: string }
  | { do: "unmount" };

interface ButtonShown {
  text: string;
  title: string | null;
  type: string | null;
  label: string | null;
}

interface FullShown {
  src: string | null;
  alt: string | null;
  close: { text: string; type: string | null; label: string | null } | null;
}

export interface Shown {
  crashed?: true;
  empty?: true;
  texts?: string[];
  buttons?: ButtonShown[];
  images?: Array<{ src: string | null; alt: string | null; draggable: string | null }>;
  stage?: Record<string, string> | null;
  frame?: Record<string, string | null> | null;
  box?: Record<string, string | number> | null;
  preview?: Record<string, string> | null;
  full?: FullShown | null;
}

interface EventRecord {
  type: string;
  prevented: boolean;
  missing?: true;
}

export interface StepRecord {
  action?: Action;
  events?: EventRecord[];
  calls: unknown[];
  captures: Array<{ on: string; id: number }>;
  releases: Array<{ on: string; id: number }>;
  outer: string[];
  shown: Shown;
}

export interface Scenario {
  id: string;
  images: Record<string, ImgState>;
  props: { src: string; alt: string; crop: unknown };
  handsBack: boolean;
  start: StepRecord;
  steps: Array<StepRecord & { action: Action; events: EventRecord[] }>;
}

export interface Recording {
  format: number;
  scenarios: Scenario[];
}

// ── Fake picture loading ────────────────────────────────────────────────────────────────────────────────────

const IMAGES = new Map<string, ImgState>();
const imgState = (el: HTMLImageElement) =>
  IMAGES.get(el.getAttribute("src") ?? "") ?? { state: "pending" as const, w: 0, h: 0 };
Object.defineProperty(HTMLImageElement.prototype, "complete", {
  configurable: true,
  get(this: HTMLImageElement) {
    return imgState(this).state !== "pending";
  },
});
Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
  configurable: true,
  get(this: HTMLImageElement) {
    const s = imgState(this);
    return s.state === "loaded" ? s.w : 0;
  },
});
Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
  configurable: true,
  get(this: HTMLImageElement) {
    const s = imgState(this);
    return s.state === "loaded" ? s.h : 0;
  },
});

/** Sets a picture's fake loading state without any event (for tests that need a picture to stop being complete). */
export function setPictureState(src: string, state: ImgState["state"], w = 0, h = 0) {
  IMAGES.set(src, { state, w, h });
}

// ── Pointer capture stub ────────────────────────────────────────────────────────────────────────────────────

const captured = new Map<number, Element>();
let captureLog: Array<{ on: string; id: number }> = [];
let releaseLog: Array<{ on: string; id: number }> = [];
let nameOf: (el: Element) => string = () => "?";
type CaptureApi = {
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
  hasPointerCapture: (id: number) => boolean;
};
const elementProto = Element.prototype as unknown as CaptureApi;
elementProto.setPointerCapture = function (this: Element, id: number) {
  captured.set(id, this);
  captureLog.push({ on: nameOf(this), id });
};
elementProto.releasePointerCapture = function (this: Element, id: number) {
  if (captured.get(id) === this) captured.delete(id);
  releaseLog.push({ on: nameOf(this), id });
};
elementProto.hasPointerCapture = function (this: Element, id: number) {
  return captured.get(id) === this;
};

// ── Numbers: non-finite values are written as { $num } ──────────────────────────────────────────────────────

const clean = (v: unknown): unknown =>
  JSON.parse(
    JSON.stringify(v, (_key, value: unknown) =>
      typeof value === "number" && !Number.isFinite(value) ? { $num: String(value) } : value,
    ),
  );

// ── The caller ──────────────────────────────────────────────────────────────────────────────────────────────

class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <div data-rec="crashed" /> : this.props.children;
  }
}

let calls: unknown[] = [];
let outerLog: string[] = [];
const OUTER_TYPES = ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "keydown"];
type CallerProps = Scenario["props"];
let setOuter: ((update: (p: CallerProps) => CallerProps) => void) | null = null;

function Caller({ initial, handsBack }: { initial: CallerProps; handsBack: boolean }) {
  const [p, setP] = useState(initial);
  setOuter = setP;
  const log = (e: { type: string }) => outerLog.push(`parent:${e.type}`);
  return (
    <div
      data-rec="parent"
      onPointerDown={log}
      onPointerMove={log}
      onPointerUp={log}
      onPointerCancel={log}
      onClick={log}
      onKeyDown={log}
    >
      <AvatarCropWidget
        src={p.src}
        alt={p.alt}
        crop={p.crop as never}
        onChange={(next) => {
          calls.push(clean(next));
          if (handsBack) setP((prev) => ({ ...prev, crop: next }));
        }}
      />
    </div>
  );
}

// ── Parts and snapshot ──────────────────────────────────────────────────────────────────────────────────────

function findPart(root: Element, part: Part): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-crop="${part}"]`);
}

function fullView() {
  const backdrop = document.querySelector<HTMLElement>("[data-crop-full]");
  if (!backdrop) return null;
  return { backdrop, img: backdrop.querySelector("img"), close: backdrop.querySelector("button") };
}

const STYLE_KEYS = ["position", "width", "height", "left", "top", "maxWidth", "maxHeight", "objectFit", "transform"];

function pickStyle(el: HTMLElement | null, keys: readonly string[]) {
  if (!el) return null;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = (el.style as unknown as Record<string, string>)[key];
    if (value) out[key] = value;
  }
  return out;
}

function texts(root: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function widgetRoot(container: Element): HTMLElement | null {
  return (container.querySelector('[data-rec="parent"]')?.firstElementChild ?? null) as HTMLElement | null;
}

function snapshot(container: HTMLElement): Shown {
  if (container.querySelector('[data-rec="crashed"]')) return { crashed: true };
  const root = widgetRoot(container);
  if (!root) return { empty: true };
  const img = root.querySelector("img");
  const frame = img?.parentElement ?? null;
  const stage = frame?.parentElement ?? null;
  const box = findPart(root, "box");
  const previewImg = Array.from(root.querySelectorAll("img")).find((i) => i !== img && !i.closest("[data-crop-full]"));
  const full = fullView();
  const parts: Part[] = ["tl", "tr", "bl", "br"];
  return {
    texts: texts(root),
    buttons: Array.from(root.querySelectorAll("button")).map((b) => ({
      text: (b.textContent ?? "").trim(),
      title: b.getAttribute("title"),
      type: b.getAttribute("type"),
      label: b.getAttribute("aria-label"),
    })),
    images: Array.from(root.querySelectorAll("img")).map((i) => ({
      src: i.getAttribute("src"),
      alt: i.getAttribute("alt"),
      draggable: i.getAttribute("draggable"),
    })),
    stage: pickStyle(stage, ["width", "height"]),
    frame: frame ? { ...pickStyle(frame, ["width", "height"]), visibility: frame.style.visibility || null } : null,
    box: box
      ? {
          ...pickStyle(box, ["left", "top", "width", "height"]),
          corners: parts.filter((p) => findPart(root, p)).length,
        }
      : null,
    preview: pickStyle(previewImg ?? null, STYLE_KEYS),
    full: full
      ? {
          src: full.img?.getAttribute("src") ?? null,
          alt: full.img?.getAttribute("alt") ?? null,
          close: full.close
            ? {
                text: (full.close.textContent ?? "").trim(),
                type: full.close.getAttribute("type"),
                label: full.close.getAttribute("aria-label"),
              }
            : null,
        }
      : null,
  };
}

// ── Runner ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Replay {
  container: HTMLElement;
  start: StepRecord;
  run: (action: Action) => Promise<StepRecord>;
  dispose: () => Promise<void>;
}

/** Mounts the caller for a scenario's images and props; `run` performs one action and returns its step record. */
export async function mountScenario(sc: Pick<Scenario, "images" | "props" | "handsBack">): Promise<Replay> {
  IMAGES.clear();
  for (const [src, s] of Object.entries(sc.images)) IMAGES.set(src, { ...s });
  captured.clear();
  calls = [];
  captureLog = [];
  releaseLog = [];
  outerLog = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const docListener = (e: Event) => outerLog.push(`document:${e.type}`);
  for (const type of OUTER_TYPES) document.addEventListener(type, docListener);
  let root: Root | null = createRoot(container);
  const origError = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  nameOf = (el) => {
    const r = widgetRoot(container);
    if (!r) return "?";
    for (const p of ["tl", "tr", "bl", "br", "box"] as Part[]) if (findPart(r, p) === el) return p;
    return el.tagName.toLowerCase();
  };
  const take = (extra: Partial<StepRecord>): StepRecord => {
    const step = {
      ...extra,
      calls,
      captures: captureLog,
      releases: releaseLog,
      outer: [...outerLog],
      shown: snapshot(container),
    };
    calls = [];
    captureLog = [];
    releaseLog = [];
    outerLog.length = 0;
    return step;
  };

  await act(async () => {
    root!.render(
      <Boundary>
        <Caller initial={sc.props} handsBack={sc.handsBack} />
      </Boundary>,
    );
  });
  const start = take({});

  const run = async (a: Action): Promise<StepRecord> => {
    const events: EventRecord[] = [];
    const dispatch = (el: Element | null, ev: Event) => {
      if (!el) {
        events.push({ type: ev.type, prevented: false, missing: true });
        return;
      }
      el.dispatchEvent(ev);
      events.push({ type: ev.type, prevented: ev.defaultPrevented });
    };
    const pe = (type: string, x: number, y: number, id = 1, button = 0) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: id,
        button,
        buttons: type === "pointerup" ? 0 : 1,
        isPrimary: id === 1,
      });
    const r = (): Element => widgetRoot(container) ?? container;
    await act(async () => {
      switch (a.do) {
        case "load": {
          IMAGES.get(a.src)!.state = "loaded";
          for (const i of Array.from(document.querySelectorAll("img")))
            if (i.getAttribute("src") === a.src) i.dispatchEvent(new Event("load"));
          break;
        }
        case "loadSilent":
          IMAGES.get(a.src)!.state = "loaded";
          break;
        case "break": {
          IMAGES.get(a.src)!.state = "broken";
          for (const i of Array.from(document.querySelectorAll("img")))
            if (i.getAttribute("src") === a.src) i.dispatchEvent(new Event("error"));
          break;
        }
        case "rerender":
          setOuter?.((p) => ({ ...p }));
          break;
        case "props":
          setOuter?.((p) => ({
            ...p,
            ...("src" in a ? { src: a.src! } : {}),
            ...("alt" in a ? { alt: a.alt! } : {}),
            ...("crop" in a ? { crop: a.crop } : {}),
          }));
          break;
        case "down":
          dispatch(findPart(r(), a.on), pe("pointerdown", a.x, a.y, a.id ?? 1, a.button ?? 0));
          break;
        case "move": {
          const id = a.id ?? 1;
          const target = captured.get(id);
          dispatch(target && target.isConnected ? target : findPart(r(), "box"), pe("pointermove", a.x, a.y, id));
          break;
        }
        case "moveOn":
          dispatch(findPart(r(), a.on), pe("pointermove", a.x, a.y, a.id ?? 1));
          break;
        case "up":
        case "cancel": {
          const id = a.id ?? 1;
          const target = captured.get(id);
          const isUp = a.do === "up";
          const event = pe(isUp ? "pointerup" : "pointercancel", isUp ? (a.x ?? 0) : 0, isUp ? (a.y ?? 0) : 0, id);
          dispatch(target && target.isConnected ? target : findPart(r(), "box"), event);
          captured.delete(id);
          break;
        }
        case "click": {
          const root0 = r();
          let el: Element | null = null;
          if (a.name === "Full image" || a.name === "Reset")
            el =
              Array.from(root0.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === a.name) ?? null;
          else if (a.name === "closeFull") el = fullView()?.close ?? null;
          else if (a.name === "fullBackdrop") el = fullView()?.backdrop ?? null;
          else if (a.name === "fullImage") el = fullView()?.img ?? null;
          else if (a.name === "box") el = findPart(root0, "box");
          else if (a.name === "heading")
            el =
              Array.from(root0.querySelectorAll("span")).find((s) => (s.textContent ?? "").trim() === "Avatar Crop") ??
              null;
          dispatch(el, new MouseEvent("click", { bubbles: true, cancelable: true }));
          break;
        }
        case "key": {
          const active = document.activeElement;
          const target = active && active !== document.body ? active : r();
          dispatch(target, new KeyboardEvent("keydown", { key: a.key, bubbles: true, cancelable: true }));
          break;
        }
        case "unmount":
          root!.unmount();
          root = null;
          break;
      }
    });
    return take({ action: a, events });
  };

  const dispose = async () => {
    console.error = origError;
    console.warn = origWarn;
    for (const type of OUTER_TYPES) document.removeEventListener(type, docListener);
    if (root) {
      const mounted = root;
      root = null;
      await act(async () => mounted.unmount());
    }
    container.remove();
  };

  return { container, start, run, dispose };
}

/** Replays a recorded scenario: the start record and one record per recorded action. */
export async function replayScenario(sc: Scenario): Promise<{ start: StepRecord; steps: StepRecord[] }> {
  const replay = await mountScenario(sc);
  try {
    const steps: StepRecord[] = [];
    for (const step of sc.steps) steps.push(await replay.run(step.action));
    return { start: replay.start, steps };
  } finally {
    await replay.dispose();
  }
}
