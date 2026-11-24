// Replays every black-box recording of the old viewer (test-fixtures/recorded-*.json) against the new module. The
// harness and snapshot functions are the recorder's. The only expectation changes are spec decisions 1 to 3, applied by
// `applyDecisions` below; decision 4 changes how the `backdrop` step is performed (full press and release sequence).
import { act, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, describe, expect, it, vi } from "vitest";

import { useEscapeOverlay } from "../../../../../../shared/hooks/use-escape-overlay";
import changes from "./test-fixtures/recorded-changes.json";
import close from "./test-fixtures/recorded-close.json";
import crash from "./test-fixtures/recorded-crash.json";
import inputs from "./test-fixtures/recorded-inputs.json";
import messages from "./test-fixtures/recorded-messages.json";
import overlays from "./test-fixtures/recorded-overlays.json";
import panels from "./test-fixtures/recorded-panels.json";
import presets from "./test-fixtures/recorded-presets.json";
import toggles from "./test-fixtures/recorded-toggles.json";

const presetState: { data: unknown } = { data: undefined };
vi.mock("../../../../../catalog/presets/index", () => ({
  usePresetSummaries: () => ({ data: presetState.data }),
}));

import { PeekPromptModal } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = Record<string, unknown>;
type Step = [string, ...unknown[]];
type Overlay = { where: "before" | "after"; result: boolean; active: boolean };
type RecordedStep = Row & { do: Step };
type Scenario = { id: string; data: string; presets: string; overlays: Overlay[]; steps: RecordedStep[] };
type RecordingFile = { format: number; pool: unknown[]; scenarios: Scenario[] };

const DATA = inputs.data as Record<string, Row>;
const PRESETS = inputs.presets as Record<string, unknown>;

// ── Harness (as recorded) ─────────────────────────────────────────────────────
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const presetValue = (key: string) => (PRESETS[key] === "__undefined__" ? undefined : clone(PRESETS[key]));

class Boundary extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function OtherOverlay({ result, active, log }: { result: boolean; active: boolean; log: (s: string) => void }) {
  useEscapeOverlay(() => {
    log("other");
    return result;
  }, active);
  return null;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
function ariaAndTitle(el: Element, out: Row) {
  for (const attr of [...el.attributes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (attr.name.startsWith("aria-") || attr.name === "title" || attr.name === "role") out[attr.name] = attr.value;
  }
}
function buttonsOf(root: Element) {
  return [...root.querySelectorAll("button")].map((b) => {
    const out: Row = { text: norm(b.textContent) };
    ariaAndTitle(b, out);
    if ((b as HTMLButtonElement).disabled) out.disabled = true;
    return out;
  });
}
function labelledOf(root: Element) {
  return [...root.querySelectorAll("*")]
    .filter((el) => el.tagName !== "BUTTON" && el.namespaceURI !== "http://www.w3.org/2000/svg")
    .filter((el) =>
      [...el.attributes].some((a) => a.name === "title" || a.name === "role" || a.name.startsWith("aria-")),
    )
    .map((el) => {
      const out: Row = { tag: el.tagName.toLowerCase(), text: norm(el.textContent) };
      ariaAndTitle(el, out);
      return out;
    });
}
const TONE = /(?:^|\s)((?:bg|text|border)-(?:red|amber|emerald|blue|purple|green)-\d+(?:\/\d+)?)(?=\s|$)/g;
function tonesOf(root: Element) {
  const out: Array<[string, string]> = [];
  for (const el of root.querySelectorAll("*")) {
    if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;
    const cls = el.getAttribute("class") ?? "";
    const found = [...cls.matchAll(TONE)].map((x) => x[1]!).sort();
    if (found.length) out.push([norm(el.textContent).slice(0, 120), found.join(" ")]);
  }
  return out;
}
function iconsOf(root: Element) {
  return [...root.querySelectorAll("svg")].map((s) => {
    const names = [...s.classList].filter((c) => c.startsWith("lucide-")).sort();
    const spin = s.classList.contains("animate-spin");
    return names.join(" ") + (spin ? " +spin" : "");
  });
}
function widthsOf(root: Element) {
  return [...root.querySelectorAll<HTMLElement>("[style]")].map((el) => el.style.width).filter(Boolean);
}
function presOf(root: Element) {
  return [...root.querySelectorAll("pre")].map((p) => p.textContent ?? "");
}
function focusOf(container: HTMLElement) {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  if (!container.contains(active)) return { where: "other", tag: active.tagName.toLowerCase() };
  const bi = [...container.querySelectorAll("button")].indexOf(active as HTMLButtonElement);
  if (bi >= 0) return { where: "modal", button: bi };
  return { where: "modal", tag: active.tagName.toLowerCase(), role: active.getAttribute("role") };
}
function snapshotOf(container: HTMLElement) {
  return {
    shown: container.firstElementChild ? "modal" : "nothing",
    text: norm(container.textContent),
    buttons: buttonsOf(container),
    labelled: labelledOf(container),
    pres: presOf(container),
    widths: widthsOf(container),
    tones: tonesOf(container),
    icons: iconsOf(container),
  };
}

const togglesIn = (c: HTMLElement) =>
  [...c.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") !== "Close");
const closeButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
const dialogEl = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="dialog"]');

/** Decision 4: a real click on the backdrop is a press and a release on it, then the click. */
function pressAndRelease(el: HTMLElement) {
  const pointer = (type: string) =>
    typeof PointerEvent === "function"
      ? new PointerEvent(type, { bubbles: true, cancelable: true })
      : new MouseEvent(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(pointer("pointerdown"));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(pointer("pointerup"));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.click();
}

type Result = Row & { data: Row };

async function run(sc: Scenario): Promise<Result[]> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const closes: number[] = [];
  const others: string[] = [];
  let crashed: string | null = null;
  const state = {
    data: clone(DATA[sc.data]!) as Row,
    onCloseVersion: 1,
    overlays: sc.overlays ?? [],
    mounted: false,
  };
  presetState.data = presetValue(sc.presets);
  const onCloseFor = (version: number) => () => closes.push(version);
  let onCloseFn = onCloseFor(1);
  const render = async () => {
    const before = state.overlays.filter((o) => o.where === "before");
    const after = state.overlays.filter((o) => o.where === "after");
    await act(async () =>
      root.render(
        <>
          {before.map((o, i) => (
            <OtherOverlay key={`b${i}`} result={o.result} active={o.active} log={(s) => others.push(s)} />
          ))}
          <Boundary onError={(e) => (crashed = e instanceof Error ? `${e.name}: ${e.message}` : String(e))}>
            <PeekPromptModal data={state.data as never} onClose={onCloseFn} />
          </Boundary>
          {after.map((o, i) => (
            <OtherOverlay key={`a${i}`} result={o.result} active={o.active} log={(s) => others.push(s)} />
          ))}
        </>,
      ),
    );
    state.mounted = true;
  };
  const out: Result[] = [];
  for (const recorded of sc.steps) {
    const step = recorded.do;
    const [kind, arg] = step;
    const rec: Row = {};
    if (kind === "open") await render();
    else if (kind === "toggle") {
      const b = togglesIn(container)[arg as number];
      if (!b) rec.missing = true;
      else await act(async () => b.click());
    } else if (kind === "close") {
      const b = closeButton(container);
      if (!b) rec.missing = true;
      else await act(async () => b.click());
    } else if (kind === "backdrop") {
      const el = container.firstElementChild as HTMLElement | null;
      if (!el) rec.missing = true;
      else await act(async () => pressAndRelease(el));
    } else if (kind === "dialog") {
      const el = dialogEl(container);
      if (!el) rec.missing = true;
      else await act(async () => el.click());
    } else if (kind === "pre") {
      const el = container.querySelectorAll("pre")[arg as number] as HTMLElement | undefined;
      if (!el) rec.missing = true;
      else await act(async () => el.click());
    } else if (kind === "heading") {
      const el = container.querySelector("h1,h2,h3,h4") as HTMLElement | null;
      if (!el) rec.missing = true;
      else await act(async () => el.click());
    } else if (kind === "key") {
      const ev = new KeyboardEvent("keydown", { key: arg as string, bubbles: true, cancelable: true });
      await act(async () => {
        document.dispatchEvent(ev);
      });
      rec.prevented = ev.defaultPrevented;
    } else if (kind === "keyOnClose") {
      const b = closeButton(container);
      const ev = new KeyboardEvent("keydown", { key: arg as string, bubbles: true, cancelable: true });
      if (!b) rec.missing = true;
      else {
        b.focus();
        await act(async () => {
          b.dispatchEvent(ev);
        });
        rec.prevented = ev.defaultPrevented;
      }
    } else if (kind === "focusClose") {
      const b = closeButton(container);
      if (!b) rec.missing = true;
      else await act(async () => b.focus());
    } else if (kind === "data") {
      state.data = clone(DATA[arg as string]!) as Row;
      await render();
    } else if (kind === "patch") {
      state.data = { ...state.data, ...clone(arg as Row) };
      await render();
    } else if (kind === "presets") {
      presetState.data = presetValue(arg as string);
      await render();
    } else if (kind === "newOnClose") {
      state.onCloseVersion += 1;
      onCloseFn = onCloseFor(state.onCloseVersion);
      await render();
    } else if (kind === "rerender") {
      await render();
    } else if (kind === "overlays") {
      state.overlays = arg as Overlay[];
      await render();
    } else if (kind === "unmount") {
      await act(async () => root.unmount());
      state.mounted = false;
    } else throw new Error(`unknown step ${kind}`);
    Object.assign(rec, snapshotOf(container));
    rec.closes = [...closes];
    rec.others = [...others];
    rec.focus = focusOf(container);
    if (crashed) rec.crash = crashed;
    out.push({ ...rec, data: state.data });
    if (crashed) break;
  }
  if (state.mounted) await act(async () => root.unmount());
  container.remove();
  return out;
}

// ── Expected step from the recording, with the spec decisions applied ─────────
const POOLED = ["text", "buttons", "labelled", "pres", "widths", "tones", "icons"] as const;
const COMPARED = ["shown", ...POOLED, "closes", "others", "focus", "prevented", "missing", "crash"] as const;

function expand(file: RecordingFile, step: RecordedStep): Row {
  const out: Row = { ...step };
  for (const key of POOLED) out[key] = clone(file.pool[step[key] as number]);
  return out;
}

/**
 * Spec decisions 1 to 3, as a narrow change to the recorded expectation:
 * 1. every toggle button gains `aria-expanded`, "true" exactly when its chevron (same order) is the open one;
 * 2. each budget bar track (one per recorded inline width) gains `aria-hidden="true"`, adding a `labelled` entry;
 * 3. the loading area gains `role="status"` + `aria-label="Assembling prompt"`, the error box `role="alert"`.
 * The new `labelled` entries sit right after the dialog's own entry (nothing else in the header is labelled).
 */
function applyDecisions(expected: Row, data: Row, count = false): Row {
  const out = clone(expected);
  const icons = out.icons as string[];
  const buttons = out.buttons as Row[];
  const chevrons = icons.filter((icon) => icon === "lucide-chevron-right" || icon === "lucide-chevron-down");
  const toggleButtons = buttons.filter((button) => button["aria-label"] !== "Close");
  if (chevrons.length !== toggleButtons.length) throw new Error("toggle buttons and chevrons don't line up");
  toggleButtons.forEach((button, i) => {
    button["aria-expanded"] = chevrons[i] === "lucide-chevron-down" ? "true" : "false";
  });
  if (count && toggleButtons.length > 0) byDecision.toggles += 1;

  const labelled = out.labelled as Row[];
  if (labelled.length === 0) return out;
  if (labelled[0]!.role !== "dialog") throw new Error("expected the dialog to be the first labelled element");
  const added: Row[] = [];
  if (icons.includes("lucide-loader-circle +spin")) {
    added.push({ tag: "div", text: "", "aria-label": "Assembling prompt", role: "status" });
    if (count) byDecision.status += 1;
  }
  const errorTone = (out.tones as Array<[string, string]>).find(([, tone]) => tone.includes("bg-red-500/5"));
  if (errorTone) {
    added.push({ tag: "div", text: norm(String(data.error)), role: "alert" });
    if (count) byDecision.alert += 1;
  }
  const bars = (out.widths as string[]).map(() => ({ tag: "div", text: "", "aria-hidden": "true" }));
  if (count && bars.length > 0) byDecision.bars += 1;
  added.push(...bars);
  labelled.splice(1, 0, ...added);
  return out;
}

function actualFields(actual: Row): Row {
  const out: Row = {};
  for (const key of COMPARED) if (key in actual) out[key] = key === "crash" ? true : actual[key];
  return out;
}

function expectedFields(expected: Row): Row {
  const out: Row = {};
  for (const key of COMPARED) if (key in expected) out[key] = key === "crash" ? true : expected[key];
  return out;
}

const FILES: Record<string, RecordingFile> = {
  messages: messages as unknown as RecordingFile,
  panels: panels as unknown as RecordingFile,
  presets: presets as unknown as RecordingFile,
  close: close as unknown as RecordingFile,
  overlays: overlays as unknown as RecordingFile,
  changes: changes as unknown as RecordingFile,
  toggles: toggles as unknown as RecordingFile,
  crash: crash as unknown as RecordingFile,
};

const totals = { scenarios: 0, exactScenarios: 0, steps: 0, exactSteps: 0, transformedSteps: 0 };
const byDecision = { toggles: 0, bars: 0, status: 0, alert: 0 };

afterAll(() => {
  console.info(
    `[peek-prompt replay] ${totals.scenarios} scenarios (${totals.exactScenarios} exact, ` +
      `${totals.scenarios - totals.exactScenarios} via decision transform); ${totals.steps} steps ` +
      `(${totals.exactSteps} exact, ${totals.transformedSteps} via decision transform); steps changed by: ` +
      `aria-expanded ${byDecision.toggles}, hidden bars ${byDecision.bars}, status ${byDecision.status}, alert ${byDecision.alert}`,
  );
});

for (const [name, file] of Object.entries(FILES)) {
  describe(`recorded-${name}`, () => {
    for (const sc of file.scenarios) {
      it(sc.id, async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        let results: Result[];
        try {
          results = await run(sc);
        } finally {
          quiet.mockRestore();
        }
        expect(results.length, "steps replayed").toBe(sc.steps.length);
        let transformedHere = 0;
        sc.steps.forEach((step, i) => {
          const recorded = expand(file, step);
          const expected = applyDecisions(recorded, results[i]!.data, true);
          const changed = JSON.stringify(expected) !== JSON.stringify(recorded);
          expect(actualFields(results[i]!), `${sc.id} step ${i} ${JSON.stringify(step.do)}`).toEqual(
            expectedFields(expected),
          );
          if (changed) transformedHere += 1;
        });
        totals.scenarios += 1;
        totals.steps += sc.steps.length;
        totals.transformedSteps += transformedHere;
        totals.exactSteps += sc.steps.length - transformedHere;
        if (transformedHere === 0) totals.exactScenarios += 1;
      });
    }
  });
}
