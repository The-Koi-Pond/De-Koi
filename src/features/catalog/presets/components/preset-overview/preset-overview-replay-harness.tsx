// Replays the black-box recordings (test-fixtures/README.md) against the editor: `PresetEditor` from `../PresetEditor`
// (the new shell with the AI Review tab) in a fresh QueryClient without retries, the stores reset, the recorder's fakes
// at the API boundary (the spec files install them with `vi.mock`, see `fake-preset-overview-apis.ts`), the faked
// `Date`, the manual timer clock and queued animation frames. Steps, settling and the snapshot follow the README.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { presetKeys } from "../../hooks/use-presets";
import { PresetEditor } from "../PresetEditor";
import { fakePresetOverviewApis, type Op, type World } from "./fake-preset-overview-apis";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Step = [string, ...unknown[]];

export type FieldSnapshot = Record<string, unknown> & { tag: string };
export type ButtonSnapshot = Record<string, unknown> & { text: string };
export type LabelledSnapshot = Record<string, unknown> & { tag: string; text: string };

export type FocusSnapshot =
  | { where: "editor"; field: number; sel: [number | null, number | null] | null }
  | { where: "editor"; button: number }
  | { where: "editor" | "other"; tag: string };

export type Shown = "nothing" | "loading" | "notFound" | "editor";

export interface Snapshot {
  shown: Shown;
  text: string;
  fields: FieldSnapshot[];
  buttons: ButtonSnapshot[];
  labelled: LabelledSnapshot[];
  rail: Array<[string, boolean]> | null;
  wrap: string[] | null;
  sections: Record<string, unknown> | null;
  ui: { presetDetailId: string | null; editorDirty: boolean };
  focus: FocusSnapshot | null;
  calls: unknown[];
  defaultPrevented?: boolean;
  renderError?: string[];
  eventError?: string[];
  unhandled?: string[];
}

/** A recorded step result with its pooled values resolved. */
export type StepResult = { step: Step } & (Snapshot | { error: string; calls: unknown[] });

interface RecordedStep {
  step: Step;
  shown?: Shown;
  text?: number;
  fields?: number;
  buttons?: number;
  labelled?: number;
  rail?: number;
  wrap?: number;
  sections?: number;
  ui?: Snapshot["ui"];
  focus?: FocusSnapshot | null;
  calls: unknown[];
  error?: string;
  defaultPrevented?: boolean;
  renderError?: string[];
  eventError?: string[];
  unhandled?: string[];
  unhandledAfterUnmount?: string[];
}

type WorldKind = "preset" | "sections" | "groups" | "variables" | "chat" | "preset2" | "connections";

type Rows = Array<Record<string, unknown> & { id: string }>;

export interface Scenario {
  id: string;
  world: Partial<Record<WorldKind, string>>;
  pre: Step[];
  presetDetailId?: string | null;
  steps: RecordedStep[];
}

export interface Recording {
  format: number;
  defaultWorld: Record<WorldKind, string>;
  worlds: {
    preset: Record<string, Record<string, unknown> & { id: string }>;
    sections: Record<string, Rows>;
    groups: Record<string, Rows>;
    variables: Record<string, Rows>;
    chat: Record<string, (Record<string, unknown> & { id: string }) | { $missingChat: true } | null>;
    preset2: Record<string, Record<string, unknown> & { id: string }>;
    connections: Record<string, Rows>;
  };
  pool: unknown[];
  scenarios: Scenario[];
}

/** `Date.now()` at the start of every scenario (2026-01-01T00:00:00.000Z). */
const BASE_TIME = 1767225600000;

// ── Value encoding ────────────────────────────────────────────────────────────

function isTag(value: object, key: string): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === key;
}

/** Turns the recordings' encoded values back into what they stand for. */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (isTag(record, "$undefined")) return undefined;
  if (isTag(record, "$number")) return Number(record.$number);
  if (isTag(record, "$error")) return new Error(String(record.$error));
  if (isTag(record, "$function")) return () => undefined;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decode(item)]));
}

/** Encodes a value the way the recorder wrote calls, keeping key order. */
function encode(value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) };
  if (typeof value === "function") return { $function: true };
  if (value instanceof Error) return { $error: value.message };
  if (value instanceof Blob) return { $blob: value.type, size: value.size };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

/** The recorded step with its pooled values filled in. */
export function resolveStep(recording: Recording, recorded: RecordedStep): StepResult {
  if (recorded.error !== undefined) return { step: recorded.step, error: recorded.error, calls: recorded.calls };
  const { text, fields, buttons, labelled, rail, wrap, sections, unhandledAfterUnmount: _after, ...rest } = recorded;
  const pool = recording.pool;
  return {
    ...rest,
    shown: recorded.shown!,
    text: pool[text!] as string,
    fields: pool[fields!] as FieldSnapshot[],
    buttons: pool[buttons!] as ButtonSnapshot[],
    labelled: pool[labelled!] as LabelledSnapshot[],
    rail: pool[rail!] as Snapshot["rail"],
    wrap: pool[wrap!] as Snapshot["wrap"],
    sections: pool[sections!] as Snapshot["sections"],
    ui: recorded.ui!,
    focus: recorded.focus ?? null,
  };
}

// ── The stored data ───────────────────────────────────────────────────────────

export interface ScenarioWorld {
  world: World;
  activeChatId: string | null;
}

function worldSet<T>(sets: Record<string, T>, name: string, kind: string): T {
  if (!(name in sets)) throw new Error(`No ${kind} set ${name}`);
  return decode(sets[name]) as T;
}

/** README, "Building the stored data from a world". */
export function worldFor(recording: Recording, scenario: Pick<Scenario, "world">): ScenarioWorld {
  const pick = (kind: WorldKind) => scenario.world[kind] ?? recording.defaultWorld[kind];
  const { worlds } = recording;
  const sectionSet = pick("sections");
  const sections = worldSet(worlds.sections, sectionSet, "sections");
  if (sectionSet !== "STD" && sectionSet !== "NONE") {
    sections.push(worldSet(worlds.sections, "STD", "sections").at(-1)!);
  }
  const chatSet = pick("chat");
  const chat = worldSet(worlds.chat, chatSet, "chat");
  return {
    world: {
      presets: [
        worldSet(worlds.preset, pick("preset"), "preset"),
        worldSet(worlds.preset2, pick("preset2"), "preset2"),
      ],
      sections,
      groups: worldSet(worlds.groups, pick("groups"), "groups"),
      variables: worldSet(worlds.variables, pick("variables"), "variables"),
      chats: chat === null || "$missingChat" in chat ? [] : [chat],
      connections: worldSet(worlds.connections, pick("connections"), "connections"),
    },
    activeChatId: chatSet === "NOCHAT" ? null : "chat-1",
  };
}

// ── Clock ─────────────────────────────────────────────────────────────────────

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
const realCancelAnimationFrame = globalThis.cancelAnimationFrame;

interface ManualTimer {
  due: number;
  order: number;
  run: () => void;
}

/**
 * Every `setTimeout` with a delay above 0 waits on a manual clock that only `wait` steps move; zero-delay timers
 * are real. `Date.now()` follows the manual clock. Animation frames queue until the next settle.
 */
class ManualClock {
  now = 0;
  private order = 0;
  private readonly timers = new Map<object, ManualTimer>();
  private readonly frames: Array<FrameRequestCallback | null> = [];

  install() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE_TIME);
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (!(typeof delay === "number" && delay > 0) || typeof handler !== "function") {
        return realSetTimeout(handler, delay, ...args);
      }
      const id = {};
      this.order += 1;
      this.timers.set(id, { due: this.now + delay, order: this.order, run: () => handler(...args) });
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: unknown) => {
      if (typeof id === "object" && id !== null && this.timers.has(id)) this.timers.delete(id);
      else realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
    }) as typeof clearTimeout;
    globalThis.requestAnimationFrame = (callback) => {
      this.frames.push(callback);
      return this.frames.length;
    };
    globalThis.cancelAnimationFrame = (handle) => {
      if (handle > 0 && handle <= this.frames.length) this.frames[handle - 1] = null;
    };
  }

  uninstall() {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    globalThis.requestAnimationFrame = realRequestAnimationFrame;
    globalThis.cancelAnimationFrame = realCancelAnimationFrame;
    this.timers.clear();
    this.frames.length = 0;
    vi.useRealTimers();
  }

  setNow(now: number) {
    this.now = now;
    vi.setSystemTime(BASE_TIME + now);
  }

  /** Runs the queued animation frames (and any they queue). */
  runFrames() {
    while (this.frames.some((frame) => frame !== null)) {
      const queued = this.frames.splice(0, this.frames.length);
      for (const frame of queued) frame?.(performance.now());
    }
  }

  /** The next timer due by `until`, removed from the queue. */
  takeDue(until: number): ManualTimer | null {
    let next: [object, ManualTimer] | null = null;
    for (const entry of this.timers) {
      const [, timer] = entry;
      if (timer.due > until) continue;
      if (!next || timer.due < next[1].due || (timer.due === next[1].due && timer.order < next[1].order)) next = entry;
    }
    if (!next) return null;
    this.timers.delete(next[0]);
    return next[1];
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────

class ControlNotFound extends Error {}

const collapse = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

const FIELD_SELECTOR = "input, textarea, select";
const WRAP_LABELS = ["XML", "MARKDOWN", "NONE"];

function describedAttributes(element: Element): Record<string, string> {
  const named: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith("aria-") || attribute.name === "title" || attribute.name === "role") {
      named[attribute.name] = attribute.value;
    }
  }
  return Object.fromEntries(Object.entries(named).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The text of `root` without its text areas' text and the Sections tab probe, whitespace collapsed. */
function textOf(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("textarea, [data-probe]")) continue;
    text += node.nodeValue ?? "";
  }
  return collapse(text);
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function fieldsOf(root: Element): Control[] {
  return [...root.querySelectorAll<Control>(FIELD_SELECTOR)];
}

function fieldSnapshot(control: Control): FieldSnapshot {
  const select = control instanceof HTMLSelectElement ? control : null;
  const inputMode = control.getAttribute("inputmode");
  return {
    tag: control.tagName.toLowerCase(),
    type: control.type,
    placeholder: control.getAttribute("placeholder"),
    value: control.value,
    ...(select
      ? {
          options: [...select.options].map((option) => [option.value, option.text]),
          selectedIndex: select.selectedIndex,
        }
      : {}),
    ...(inputMode !== null ? { inputMode } : {}),
    ...(control.disabled ? { disabled: true } : {}),
    ...describedAttributes(control),
  };
}

export class PresetOverviewHarness {
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  private root: Root | null = null;
  private host: HTMLDivElement | null = null;
  private seenCalls = 0;
  private readonly clock = new ManualClock();
  private renderErrors: unknown[] = [];
  private eventErrors: string[] = [];
  private unhandled: string[] = [];
  private readonly otherRejectionListeners: NodeJS.UnhandledRejectionListener[];
  private readonly onUnhandled = (reason: unknown) => {
    this.unhandled.push(messageOf(reason));
  };
  private readonly onWindowError = (event: ErrorEvent) => {
    event.preventDefault();
    const error = event.error as Error | undefined;
    this.eventErrors.push(error ? `${error.name}: ${error.message}` : event.message);
  };

  constructor({ world, activeChatId }: ScenarioWorld, presetDetailId: string | null) {
    fakePresetOverviewApis.reset(world);
    this.clock.install();
    useUIStore.setState(useUIStore.getInitialState(), true);
    useChatStore.setState(useChatStore.getInitialState(), true);
    useUIStore.setState({ presetDetailId });
    useChatStore.setState({ activeChatId });
    window.addEventListener("error", this.onWindowError);
    this.otherRejectionListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", this.onUnhandled);
  }

  private async guarded(run: () => void | Promise<void>) {
    try {
      await act(run);
    } catch (error) {
      if (!this.renderErrors.includes(error)) this.renderErrors.push(error);
    }
  }

  /** 10 rounds of `act` around a real `setTimeout(0)` plus the queued animation frames. */
  async settle() {
    for (let round = 0; round < 10; round += 1) {
      await this.guarded(async () => {
        await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
        this.clock.runFrames();
      });
    }
  }

  async mount() {
    this.host = document.createElement("div");
    document.body.appendChild(this.host);
    this.root = createRoot(this.host, {
      onUncaughtError: (error) => {
        if (!this.renderErrors.includes(error)) this.renderErrors.push(error);
      },
    });
    await this.guarded(() => {
      this.root!.render(
        <QueryClientProvider client={this.queryClient}>
          <PresetEditor />
        </QueryClientProvider>,
      );
    });
    await this.settle();
  }

  /** Releases held ops, unmounts, empties the page and returns rejections that came after unmounting. */
  async unmount(): Promise<string[]> {
    fakePresetOverviewApis.releaseAll();
    await this.guarded(() => this.root?.unmount());
    this.host?.remove();
    document.body.replaceChildren();
    const before = this.unhandled.length;
    for (let round = 0; round < 4; round += 1) await new Promise((resolve) => realSetTimeout(resolve, 0));
    const after = this.unhandled.slice(before);
    this.queryClient.clear();
    this.clock.uninstall();
    window.removeEventListener("error", this.onWindowError);
    process.off("unhandledRejection", this.onUnhandled);
    for (const listener of this.otherRejectionListeners) process.on("unhandledRejection", listener);
    return after;
  }

  get element(): HTMLElement {
    return this.host!;
  }

  // ── Locators ──

  buttonWithText(text: string): HTMLButtonElement {
    const found = [...this.host!.querySelectorAll("button")].find((button) => collapse(button.textContent) === text);
    if (!found) throw new ControlNotFound(`no button "${text}"`);
    return found;
  }

  private buttonMatching(selector: string, what: string): HTMLButtonElement {
    const found = this.host!.querySelector<HTMLButtonElement>(selector);
    if (!found) throw new ControlNotFound(`no ${what}`);
    return found;
  }

  private buttonHolding(iconClass: string, what: string): HTMLButtonElement {
    const icon = this.host!.querySelector(`button svg.${iconClass}`);
    const button = icon?.closest("button");
    if (!button) throw new ControlNotFound(`no ${what}`);
    return button;
  }

  tabButton(label: string): HTMLButtonElement {
    const nav = this.host!.querySelector("nav");
    const found = nav && [...nav.querySelectorAll("button")].find((button) => collapse(button.textContent) === label);
    if (!found) throw new ControlNotFound(`no tab "${label}"`);
    return found;
  }

  field(name: string): Control {
    const byPlaceholder = (placeholder: string, index = 0) => {
      const found = this.host!.querySelectorAll<Control>(`[placeholder="${placeholder}"]`)[index];
      if (!found) throw new ControlNotFound(`no field ${name}`);
      return found;
    };
    switch (name) {
      case "headerName":
        return byPlaceholder("Preset name…");
      case "name":
        return byPlaceholder("Preset name…", 1);
      case "description":
        return byPlaceholder("What does this preset do?");
      case "author":
        return byPlaceholder("Your name (optional)");
      default:
        throw new Error(`Unknown field ${name}`);
    }
  }

  // ── Events ──

  async click(element: Element) {
    await this.guarded(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await this.settle();
  }

  async type(control: Control, value: string) {
    const prototype = Object.getPrototypeOf(control) as object;
    await this.guarded(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await this.settle();
  }

  async focus(control: HTMLElement) {
    await this.guarded(() => control.focus());
    await this.settle();
  }

  async blur(control: HTMLElement) {
    if (document.activeElement !== control) await this.guarded(() => control.focus());
    await this.guarded(() => control.blur());
    await this.settle();
  }

  async key(control: HTMLElement, key: string): Promise<boolean> {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await this.guarded(() => {
      control.dispatchEvent(event);
    });
    await this.settle();
    return event.defaultPrevented;
  }

  async wait(ms: number) {
    const until = this.clock.now + ms;
    for (let timer = this.clock.takeDue(until); timer; timer = this.clock.takeDue(until)) {
      this.clock.setNow(timer.due);
      await this.guarded(() => timer.run());
      await this.settle();
    }
    this.clock.setNow(until);
    await this.settle();
  }

  private async afterAct(run: () => void | Promise<unknown>) {
    await this.guarded(async () => {
      await run();
    });
    await this.settle();
  }

  /** Runs one recorded step; returns the extra result keys (`defaultPrevented`). */
  async run(step: Step): Promise<Partial<Snapshot>> {
    const [kind, ...args] = step;
    const str = (index: number) => args[index] as string;
    switch (kind) {
      case "mount":
        await this.mount();
        return {};
      case "hold":
        fakePresetOverviewApis.hold(str(0) as Op);
        await this.settle();
        return {};
      case "fail":
        fakePresetOverviewApis.failNext(str(0) as Op, str(1));
        await this.settle();
        return {};
      case "confirm":
        fakePresetOverviewApis.answerConfirm(args[0] as boolean);
        await this.settle();
        return {};
      case "exportReport":
        fakePresetOverviewApis.setExportReport(decode(args[0]));
        await this.settle();
        return {};
      case "release":
        await this.afterAct(() => fakePresetOverviewApis.release(str(0) as Op));
        return {};
      case "wait":
        await this.wait(args[0] as number);
        return {};
      case "tab":
        await this.click(this.tabButton(str(0)));
        return {};
      case "wrap":
        await this.click(this.buttonWithText(str(0).toUpperCase()));
        return {};
      case "back":
        await this.click(this.buttonHolding("lucide-arrow-left", "Back button"));
        return {};
      case "delete":
        await this.click(this.buttonHolding("lucide-trash-2", "Delete button"));
        return {};
      case "save":
        await this.click(this.buttonWithText("Save"));
        return {};
      case "keepEditing":
        await this.click(this.buttonWithText("Keep editing"));
        return {};
      case "discard":
        await this.click(this.buttonWithText("Discard"));
        return {};
      case "saveClose":
        await this.click(this.buttonWithText("Save & close"));
        return {};
      case "export":
        await this.click(this.buttonMatching('button[title="Export preset"]', "Export button"));
        return {};
      case "dismissError":
        await this.click(this.buttonMatching('button[aria-label="Dismiss save error"]', "dismiss button"));
        return {};
      case "focus":
        await this.focus(this.field(str(0)));
        return {};
      case "blur":
        await this.blur(this.field(str(0)));
        return {};
      case "type":
        await this.type(this.field(str(0)), str(1));
        return {};
      case "key":
        return { defaultPrevented: await this.key(this.field(str(0)), str(1)) };
      case "refresh": {
        const id = useUIStore.getState().presetDetailId!;
        fakePresetOverviewApis.patchPreset(id, decode(args[0]) as Record<string, unknown>);
        await this.afterAct(() => this.queryClient.invalidateQueries({ queryKey: presetKeys.full(id) }));
        return {};
      }
      case "deleteStored":
        fakePresetOverviewApis.deletePreset(str(0));
        await this.settle();
        return {};
      case "sectionsMutate": {
        const props = fakePresetOverviewApis.probeProps;
        const mutation = props?.[str(0)] as { mutate: (arg: unknown) => void } | undefined;
        if (!mutation) throw new ControlNotFound(`no Sections tab prop ${str(0)}`);
        await this.afterAct(() => mutation.mutate(decode(args[1])));
        return {};
      }
      case "switchPreset": {
        const id = args[0] as string | null;
        await this.afterAct(() => {
          const ui = useUIStore.getState();
          if (id === null) ui.closePresetDetail();
          else ui.openPresetDetail(id);
        });
        return {};
      }
      case "setChat":
        await this.afterAct(() => useChatStore.setState({ activeChatId: args[0] as string | null }));
        return {};
      default:
        throw new Error(`Unknown step kind ${kind}`);
    }
  }

  /** Runs a step and returns what the recorder would have recorded after it. */
  async record(step: Step): Promise<StepResult> {
    const errorsBefore = this.renderErrors.length;
    const eventErrorsBefore = this.eventErrors.length;
    const unhandledBefore = this.unhandled.length;
    let extra: Partial<Snapshot>;
    try {
      extra = await this.run(step);
    } catch (error) {
      if (error instanceof ControlNotFound) return { step, error: error.message, calls: this.takeCalls() };
      throw error;
    }
    const snapshot = this.snapshot();
    const renderError = this.renderErrors.slice(errorsBefore).map((error) => {
      const { name, message } = error as Error;
      return `${name}: ${message}`;
    });
    const eventError = this.eventErrors.slice(eventErrorsBefore);
    const unhandled = this.unhandled.slice(unhandledBefore);
    return {
      step,
      ...snapshot,
      ...(renderError.length > 0 ? { renderError } : {}),
      ...(eventError.length > 0 ? { eventError } : {}),
      ...(unhandled.length > 0 ? { unhandled } : {}),
      ...extra,
    };
  }

  private takeCalls(): unknown[] {
    const calls = fakePresetOverviewApis.calls.slice(this.seenCalls);
    this.seenCalls = fakePresetOverviewApis.calls.length;
    return calls.map((call) => encode(call));
  }

  private shown(): Shown {
    const host = this.host!;
    if (!host.firstChild) return "nothing";
    if (host.querySelector(".shimmer")) return "loading";
    if (collapse(host.textContent) === "Preset not found") return "notFound";
    return "editor";
  }

  private focusSnapshot(): FocusSnapshot | null {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const host = this.host!;
    if (!host.contains(active)) return { where: "other", tag: active.tagName.toLowerCase() };
    if (active.matches(FIELD_SELECTOR)) {
      const control = active as HTMLInputElement;
      const sel: [number | null, number | null] | null =
        active instanceof HTMLSelectElement ? null : [control.selectionStart, control.selectionEnd];
      return { where: "editor", field: fieldsOf(host).indexOf(control), sel };
    }
    if (active instanceof HTMLButtonElement) {
      return { where: "editor", button: [...host.querySelectorAll("button")].indexOf(active) };
    }
    return { where: "editor", tag: active.tagName.toLowerCase() };
  }

  snapshot(): Omit<Snapshot, "renderError" | "eventError" | "unhandled" | "defaultPrevented"> {
    const host = this.host!;
    const buttons = [...host.querySelectorAll("button")];
    const nav = host.querySelector("nav");
    const wrapButtons = buttons.filter((button) => WRAP_LABELS.includes(collapse(button.textContent)));
    const probe = host.querySelector("[data-probe]");
    const { presetDetailId, editorDirty } = useUIStore.getState();
    return {
      shown: this.shown(),
      text: textOf(host),
      fields: fieldsOf(host).map(fieldSnapshot),
      buttons: buttons.map((button) => ({
        text: collapse(button.textContent),
        ...describedAttributes(button),
        ...(button.disabled ? { disabled: true } : {}),
      })),
      labelled: [...host.querySelectorAll("*")]
        .filter(
          (element) =>
            !element.matches(`button, ${FIELD_SELECTOR}`) &&
            !(element instanceof SVGElement) &&
            Object.keys(describedAttributes(element)).length > 0,
        )
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: collapse(element.textContent),
          ...describedAttributes(element),
        })),
      rail: nav
        ? [...nav.querySelectorAll("button")].map((button): [string, boolean] => [
            collapse(button.textContent),
            button.classList.contains("ring-1"),
          ])
        : null,
      wrap:
        wrapButtons.length > 0
          ? wrapButtons
              .filter((button) => button.classList.contains("text-purple-400"))
              .map((button) => collapse(button.textContent))
          : null,
      sections: probe ? (JSON.parse(probe.textContent ?? "null") as Record<string, unknown>) : null,
      ui: { presetDetailId, editorDirty },
      focus: this.focusSnapshot(),
      calls: this.takeCalls(),
    };
  }
}

/** Mounts a fresh editor for a recorded scenario and replays every step. */
export async function replayScenario(recording: Recording, scenario: Scenario) {
  const presetDetailId = scenario.presetDetailId === undefined ? "preset-1" : scenario.presetDetailId;
  const harness = new PresetOverviewHarness(worldFor(recording, scenario), presetDetailId);
  const results: StepResult[] = [];
  let unhandledAfterUnmount: string[] = [];
  try {
    for (const step of scenario.pre) await harness.run(step);
    for (const recorded of scenario.steps) results.push(await harness.record(recorded.step));
  } finally {
    unhandledAfterUnmount = await harness.unmount();
  }
  return { results, unhandledAfterUnmount };
}
