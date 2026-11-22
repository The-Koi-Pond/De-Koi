// Replays the black-box recordings (test-fixtures/README.md) against the list: the page wrapper the README shows
// (the real preset hooks in a fresh QueryClient without retries, the list's mutations logged), the recorder's fakes
// at the API boundary (the spec files install them with `vi.mock`, see `fake-preset-variables-apis.ts`), the faked
// `Date`, the manual timer clock and queued animation frames. Steps, settling and the snapshot follow the README.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import {
  presetKeys,
  useCreateVariable,
  useDeleteVariable,
  usePresetFull,
  useReorderVariables,
  useUpdateVariable,
} from "../../hooks/use-presets";
import { fakePresetVariablesApis, type Op, type World } from "./fake-preset-variables-apis";
import { PresetVariablesEditor } from "./PresetVariablesEditor";
import type { ChoiceBlockRow } from "./variable-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Step = [string, ...unknown[]];

export type FieldSnapshot = Record<string, unknown> & { tag: string };
export type ButtonSnapshot = Record<string, unknown> & { text: string };
export type LabelledSnapshot = Record<string, unknown> & { tag: string };

export interface ScopeSnapshot {
  text: string;
  fields: FieldSnapshot[];
  buttons: ButtonSnapshot[];
  labelled: LabelledSnapshot[];
}

export type CardFlag = "expanded" | "chevronDown" | "faded" | "lineBefore" | "lineAfter";

export type FocusSnapshot = { where: "editor" | "dialog" | "other" } & (
  { field: number; sel: [number | null, number | null] } | { button: number } | { tag: string }
);

export interface DataTransferSnapshot {
  effectAllowed: string;
  dropEffect: string;
  data: Record<string, string>;
}

export interface Snapshot extends ScopeSnapshot {
  cards: CardFlag[][];
  modal: ScopeSnapshot | null;
  focus: FocusSnapshot | null;
  calls: unknown[];
  renderError?: string[];
  unhandled?: string[];
  defaultPrevented?: boolean;
  dataTransfer?: DataTransferSnapshot | null;
  unhandledAfterUnmount?: string[];
}

/** A recorded step result with its pooled values resolved. */
export type StepResult = { step: Step } & (Snapshot | { error: string; calls: unknown[] });

interface RecordedStep {
  step: Step;
  text?: number;
  fields?: number;
  buttons?: number;
  labelled?: number;
  cards?: number;
  modal?: number;
  focus?: FocusSnapshot | null;
  calls: unknown[];
  error?: string;
  renderError?: string[];
  unhandled?: string[];
  defaultPrevented?: boolean;
  dataTransfer?: DataTransferSnapshot | null;
  unhandledAfterUnmount?: string[];
}

export interface Scenario {
  id: string;
  world: Partial<Record<keyof World, string>>;
  pre: Step[];
  steps: RecordedStep[];
}

export interface Recording {
  format: number;
  defaultWorld: Record<keyof World, string>;
  worlds: { variables: Record<string, unknown[]>; preset: Record<string, Record<string, unknown>> };
  pool: unknown[];
  scenarios: Scenario[];
}

export const PRESET_ID = "preset-1";
/** `Date.now()` at the start of every scenario (2026-01-01T00:00:00.000Z). */
const BASE_TIME = 1767225600000;

// ── Value encoding ────────────────────────────────────────────────────────────

function isTag(value: object, key: string): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === key;
}

/** Turns the recordings' encoded values back into what they stand for. */
export function decode(value: unknown): unknown {
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
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

/** The recorded step with its pooled values filled in. */
export function resolveStep(recording: Recording, recorded: RecordedStep): StepResult {
  if (recorded.error !== undefined) return { step: recorded.step, error: recorded.error, calls: recorded.calls };
  const { text, fields, buttons, labelled, cards, modal, ...rest } = recorded;
  return {
    ...rest,
    text: recording.pool[text!] as string,
    fields: recording.pool[fields!] as FieldSnapshot[],
    buttons: recording.pool[buttons!] as ButtonSnapshot[],
    labelled: recording.pool[labelled!] as LabelledSnapshot[],
    cards: recording.pool[cards!] as CardFlag[][],
    modal: recording.pool[modal!] as ScopeSnapshot | null,
    focus: recorded.focus ?? null,
  };
}

function variablesSet(recording: Recording, name: string): Array<Record<string, unknown> & { id: string }> {
  const set = recording.worlds.variables[name];
  if (set === undefined) throw new Error(`No variables set ${name}`);
  return decode(set) as Array<Record<string, unknown> & { id: string }>;
}

export function worldFor(recording: Recording, scenario: Scenario): World {
  const variables = variablesSet(recording, scenario.world.variables ?? recording.defaultWorld.variables);
  const presetName = scenario.world.preset ?? recording.defaultWorld.preset;
  const preset = recording.worlds.preset[presetName];
  if (preset === undefined) throw new Error(`No preset set ${presetName}`);
  const decoded = decode(preset) as Record<string, unknown> & { id: string };
  if (decoded.variableOrder === "$ids") decoded.variableOrder = variables.map((row) => row.id);
  return { variables, preset: decoded };
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
  readonly frames: Array<FrameRequestCallback | null> = [];

  install() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE_TIME);
    const timers = this.timers;
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (!(typeof delay === "number" && delay > 0) || typeof handler !== "function") {
        return realSetTimeout(handler, delay, ...args);
      }
      const id = {};
      this.order += 1;
      timers.set(id, { due: this.now + delay, order: this.order, run: () => handler(...args) });
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: unknown) => {
      if (typeof id === "object" && id !== null && timers.has(id)) timers.delete(id);
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

// ── The page ──────────────────────────────────────────────────────────────────

type Mutation = { mutate: (...args: never[]) => unknown; mutateAsync: (...args: never[]) => unknown };

/** The hook's mutation with `mutate` / `mutateAsync` noted before they run. */
function logged<M extends Mutation>(name: string, mutation: M): M {
  const call =
    (kind: "mutate" | "mutateAsync", run: (...args: never[]) => unknown) =>
    (...args: never[]) => {
      fakePresetVariablesApis.record([kind, name, structuredClone(args[0] as unknown)]);
      return run(...args);
    };
  return {
    ...mutation,
    mutate: call("mutate", mutation.mutate),
    mutateAsync: call("mutateAsync", mutation.mutateAsync),
  };
}

/** How the real preset editor feeds the list. */
function Page() {
  const { data } = usePresetFull(PRESET_ID);
  const create = useCreateVariable();
  const update = useUpdateVariable();
  const del = useDeleteVariable();
  const reorder = useReorderVariables();
  const variables = useMemo(() => (data?.choiceBlocks ? data.choiceBlocks : []), [data?.choiceBlocks]);
  if (!data) return null;
  return (
    <PresetVariablesEditor
      presetId={PRESET_ID}
      variables={variables as ChoiceBlockRow[]}
      onCreateVariable={logged("create", create)}
      onUpdateVariable={logged("update", update)}
      onDeleteVariable={logged("delete", del)}
      onReorderVariables={logged("reorder", reorder)}
    />
  );
}

// ── Harness ───────────────────────────────────────────────────────────────────

class ControlNotFound extends Error {}

const collapse = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

const FIELD_SELECTOR = "input, textarea, select";

function describedAttributes(element: Element): Record<string, string> {
  const named: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith("aria-") || attribute.name === "title" || attribute.name === "role") {
      named[attribute.name] = attribute.value;
    }
  }
  return named;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The text of `root` without its text areas' text, whitespace collapsed. */
function textOf(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("textarea")) continue;
    text += node.nodeValue ?? "";
  }
  return collapse(text);
}

function fieldsOf(root: Element): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  return [...root.querySelectorAll<HTMLInputElement>(FIELD_SELECTOR)];
}

function scopeOf(root: Element): ScopeSnapshot {
  return {
    text: textOf(root),
    fields: fieldsOf(root).map((control) => ({
      tag: control.tagName.toLowerCase(),
      type: control.type,
      placeholder: control.getAttribute("placeholder"),
      value: control.value,
      ...(control.disabled ? { disabled: true } : {}),
      ...describedAttributes(control),
    })),
    buttons: [...root.querySelectorAll("button")].map((button) => ({
      text: collapse(button.textContent),
      ...describedAttributes(button),
      ...(button.disabled ? { disabled: true } : {}),
    })),
    labelled: [...root.querySelectorAll("*")]
      .filter(
        (element) =>
          !element.matches(`button, ${FIELD_SELECTOR}`) &&
          !(element instanceof SVGElement) &&
          Object.keys(describedAttributes(element)).length > 0,
      )
      .map((element) => ({ tag: element.tagName.toLowerCase(), ...describedAttributes(element) })),
  };
}

interface FakeDataTransfer {
  effectAllowed: string;
  dropEffect: string;
  data: Record<string, string>;
  types: string[];
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
}

function newDataTransfer(): FakeDataTransfer {
  const transfer: FakeDataTransfer = {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    data: {},
    types: [],
    setData: (type, value) => {
      transfer.data[type] = value;
    },
    getData: (type) => transfer.data[type] ?? "",
  };
  return transfer;
}

const CARD_SELECTOR = "[data-card-index]";
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;

/** Card n (and anything inside it) measures `{ top: 100n, height: 100, … }`, as the recorder laid them out. */
function installCardLayout() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const card = this.closest(CARD_SELECTOR);
    if (!card) return realGetBoundingClientRect.call(this);
    const cards = [...(card.parentElement?.querySelectorAll(`:scope > ${CARD_SELECTOR}`) ?? [])];
    const top = 100 * cards.indexOf(card);
    return { top, height: 100, bottom: top + 100, left: 0, width: 600, right: 600, x: 0, y: top } as DOMRect;
  };
}

export class VariablesHarness {
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  private root: Root | null = null;
  private host: HTMLDivElement | null = null;
  private seenCalls = 0;
  private readonly clock = new ManualClock();
  private renderErrors: unknown[] = [];
  private unhandled: string[] = [];
  private dataTransfer: FakeDataTransfer | null = null;
  private readonly otherRejectionListeners: NodeJS.UnhandledRejectionListener[];
  private readonly worldSets: Recording["worlds"] | null;
  private readonly onUnhandled = (reason: unknown) => {
    this.unhandled.push(messageOf(reason));
  };

  constructor(world: World, worldSets: Recording["worlds"] | null = null) {
    fakePresetVariablesApis.reset(world);
    this.worldSets = worldSets;
    this.clock.install();
    installCardLayout();
    // Some old behavior leaves rejections unhandled on purpose (they are part of the recording); collect them here
    // instead of letting the test runner report them.
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
          <Page />
        </QueryClientProvider>,
      );
    });
    await this.settle();
  }

  /** Releases held ops, unmounts, empties the page and returns rejections that came after unmounting. */
  async unmount(): Promise<string[]> {
    fakePresetVariablesApis.releaseAll();
    await this.guarded(() => this.root?.unmount());
    this.host?.remove();
    document.body.replaceChildren();
    const before = this.unhandled.length;
    for (let round = 0; round < 4; round += 1) await new Promise((resolve) => realSetTimeout(resolve, 0));
    const after = this.unhandled.slice(before);
    this.queryClient.clear();
    this.clock.uninstall();
    Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
    vi.restoreAllMocks();
    process.off("unhandledRejection", this.onUnhandled);
    for (const listener of this.otherRejectionListeners) process.on("unhandledRejection", listener);
    return after;
  }

  get element(): HTMLElement {
    return this.host!;
  }

  // ── Locators ──

  cards(): HTMLElement[] {
    return [...this.host!.querySelectorAll<HTMLElement>(CARD_SELECTOR)];
  }

  card(n: number): HTMLElement {
    const card = this.cards()[n];
    if (!card) throw new ControlNotFound(`no card #${n}`);
    return card;
  }

  private inCard(n: number, selector: string, what: string): HTMLElement {
    const found = this.card(n).querySelector<HTMLElement>(selector);
    if (!found) throw new ControlNotFound(`no ${what} in card #${n}`);
    return found;
  }

  chevron(n: number): HTMLButtonElement {
    return this.inCard(n, "button[aria-expanded]", "chevron") as HTMLButtonElement;
  }

  /** The name follows the chevron and the hash icon. */
  nameOf(n: number): HTMLElement {
    const name = this.chevron(n).nextElementSibling?.nextElementSibling;
    if (!(name instanceof HTMLElement)) throw new ControlNotFound(`no name in card #${n}`);
    return name;
  }

  grip(n: number): HTMLElement {
    return this.inCard(n, '[title="Drag to reorder"]', "grip");
  }

  /** The element that holds the cards. */
  list(): HTMLElement {
    const list = this.cards()[0]?.parentElement;
    if (!list) throw new ControlNotFound("no list");
    return list;
  }

  modalRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]')?.parentElement ?? null;
  }

  private modal(): HTMLElement {
    const modal = this.modalRoot();
    if (!modal) throw new ControlNotFound("no value editor");
    return modal;
  }

  buttonWithText(text: string, root: Element = this.host!): HTMLButtonElement {
    const found = [...root.querySelectorAll("button")].find((button) => collapse(button.textContent) === text);
    if (!found) throw new ControlNotFound(`no button "${text}"`);
    return found;
  }

  private nthTitled(title: string, index: number): HTMLButtonElement {
    const found = this.host!.querySelectorAll<HTMLButtonElement>(`button[title="${title}"]`)[index];
    if (!found) throw new ControlNotFound(`no "${title}" button #${index}`);
    return found;
  }

  private byPlaceholder(placeholder: string, index = 0): HTMLInputElement {
    const found = [...this.host!.querySelectorAll<HTMLInputElement>("input")].filter(
      (input) => input.getAttribute("placeholder") === placeholder,
    )[index];
    if (!found) throw new ControlNotFound(`no field "${placeholder}" #${index}`);
    return found;
  }

  field(name: string): HTMLElement {
    if (name === "body") return document.body;
    if (name === "name") return this.byPlaceholder("VARIABLE_NAME");
    if (name === "question") return this.byPlaceholder("What should the user choose?");
    if (name === "separator") return this.byPlaceholder(", ");
    if (name === "editor") {
      const area = this.modal().querySelector("textarea");
      if (!area) throw new ControlNotFound("no value editor text area");
      return area;
    }
    const [kind, at] = name.split(":");
    if (kind === "label") return this.byPlaceholder("Label…", Number(at));
    if (kind === "value") return this.byPlaceholder("Value…", Number(at));
    throw new Error(`Unknown field ${name}`);
  }

  // ── Events ──

  async click(element: Element) {
    await this.guarded(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await this.settle();
  }

  async setValue(control: HTMLElement, value: string) {
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

  async select(control: HTMLElement, start: number, end: number) {
    (control as HTMLInputElement).setSelectionRange(start, end);
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

  async mouseDown(element: Element) {
    await this.guarded(() => {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await this.settle();
  }

  async drag(type: string, target: Element, clientY = 0): Promise<boolean> {
    if (type === "dragstart") this.dataTransfer = newDataTransfer();
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, "dataTransfer", { value: this.dataTransfer });
    await this.guarded(() => {
      target.dispatchEvent(event);
    });
    await this.settle();
    return event.defaultPrevented;
  }

  private dataTransferSnapshot(): DataTransferSnapshot | null {
    if (!this.dataTransfer) return null;
    const { effectAllowed, dropEffect, data } = this.dataTransfer;
    return { effectAllowed, dropEffect, data: { ...data } };
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

  /** Runs one recorded step; returns the extra result keys (`defaultPrevented`, `dataTransfer`). */
  async run(step: Step): Promise<Partial<Snapshot>> {
    const [kind, ...args] = step;
    const num = (index: number) => args[index] as number;
    const str = (index: number) => args[index] as string;
    const dragged = async (type: string, target: Element, clientY?: number) => {
      const defaultPrevented = await this.drag(type, target, clientY);
      return { defaultPrevented, dataTransfer: this.dataTransferSnapshot() };
    };
    switch (kind) {
      case "mount":
        await this.mount();
        return {};
      case "toggle":
        await this.click(this.chevron(num(0)));
        return {};
      case "clickName":
        await this.click(this.nameOf(num(0)));
        return {};
      case "moveUp":
        await this.click(this.inCard(num(0), 'button[title="Move up"]', "Move up button"));
        return {};
      case "moveDown":
        await this.click(this.inCard(num(0), 'button[title="Move down"]', "Move down button"));
        return {};
      case "delete":
        await this.click(this.inCard(num(0), 'button[title="Delete variable"]', "trash button"));
        return {};
      case "addVariable":
        await this.click(this.buttonWithText("Add Variable"));
        return {};
      case "addOption":
        await this.click(this.buttonWithText("Add Option"));
        return {};
      case "removeOption":
        await this.click(this.nthTitled("Remove option", num(0)));
        return {};
      case "expandValue":
        await this.click(this.nthTitled("Expand value editor", num(0)));
        return {};
      case "switch": {
        const found = this.host!.querySelector(`button[role="switch"][aria-label="${str(0)}"]`);
        if (!found) throw new ControlNotFound(`no switch "${str(0)}"`);
        await this.click(found);
        return {};
      }
      case "close": {
        const close = this.modal().querySelector('button[aria-label="Close"]');
        if (!close) throw new ControlNotFound("no close button");
        await this.click(close);
        return {};
      }
      case "done":
        await this.click(this.buttonWithText("Done", this.modal()));
        return {};
      case "backdrop":
        await this.click(this.modal());
        return {};
      case "focus":
        await this.focus(this.field(str(0)));
        return {};
      case "blur":
        await this.blur(this.field(str(0)));
        return {};
      case "type":
        await this.setValue(this.field(str(0)), str(1));
        return {};
      case "append": {
        const control = this.field(str(0)) as HTMLInputElement;
        await this.setValue(control, control.value + str(1));
        return {};
      }
      case "select":
        await this.select(this.field(str(0)), num(1), num(2));
        return {};
      case "key":
        return { defaultPrevented: await this.key(this.field(str(0)), str(1)) };
      case "gripDown":
        await this.mouseDown(this.grip(num(0)));
        return {};
      case "dragStart":
        return dragged("dragstart", this.card(num(0)));
      case "dragOver":
        return dragged("dragover", this.card(num(0)), num(1));
      case "drop":
        return dragged("drop", this.card(num(0)));
      case "dragEnd":
        return dragged("dragend", this.card(num(0)));
      case "dragOverList":
        return dragged("dragover", this.list(), num(0));
      case "dropList":
        return dragged("drop", this.list());
      case "confirm":
        fakePresetVariablesApis.answerConfirm(args[0] as boolean);
        await this.settle();
        return {};
      case "fail":
        fakePresetVariablesApis.failNext(str(0) as Op, str(1));
        await this.settle();
        return {};
      case "hold":
        fakePresetVariablesApis.hold(str(0) as Op);
        await this.settle();
        return {};
      case "release":
        await this.afterAct(() => fakePresetVariablesApis.release(str(0) as Op));
        return {};
      case "patchVariable":
        fakePresetVariablesApis.patchVariable(str(0), decode(args[1]) as Record<string, unknown>);
        await this.settle();
        return {};
      case "setVariables": {
        const set = this.worldSets?.variables[str(0)];
        if (set === undefined) throw new Error(`No variables set ${str(0)}`);
        fakePresetVariablesApis.setVariables(decode(set) as Array<Record<string, unknown> & { id: string }>);
        await this.settle();
        return {};
      }
      case "refetch":
        await this.afterAct(() => this.queryClient.invalidateQueries({ queryKey: presetKeys.full(PRESET_ID) }));
        return {};
      case "wait":
        await this.wait(num(0));
        return {};
      default:
        throw new Error(`Unknown step kind ${kind}`);
    }
  }

  /** Runs a step and returns what the recorder would have recorded after it. */
  async record(step: Step): Promise<StepResult> {
    const errorsBefore = this.renderErrors.length;
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
    const unhandled = this.unhandled.slice(unhandledBefore);
    return {
      step,
      ...snapshot,
      ...(renderError.length > 0 ? { renderError } : {}),
      ...(unhandled.length > 0 ? { unhandled } : {}),
      ...extra,
    };
  }

  private takeCalls(): unknown[] {
    const calls = fakePresetVariablesApis.calls.slice(this.seenCalls);
    this.seenCalls = fakePresetVariablesApis.calls.length;
    return calls.map((call) => encode(call));
  }

  /** The flags the recorder noted per card. */
  private cardFlags(card: HTMLElement): CardFlag[] {
    const flags: CardFlag[] = [];
    if (card.querySelector('input[placeholder="VARIABLE_NAME"]')) flags.push("expanded");
    if (card.querySelector("button[aria-expanded] svg.lucide-chevron-down")) flags.push("chevronDown");
    if (card.classList.contains("opacity-40")) flags.push("faded");
    if (card.querySelector(':scope > [data-drop-line="before"]')) flags.push("lineBefore");
    if (card.querySelector(':scope > [data-drop-line="after"]')) flags.push("lineAfter");
    return flags;
  }

  private focusSnapshot(modal: HTMLElement | null): FocusSnapshot | null {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const scope = this.host!.contains(active) ? this.host! : modal?.contains(active) ? modal : null;
    const where = scope === this.host ? "editor" : scope ? "dialog" : "other";
    if (scope && active.matches(FIELD_SELECTOR)) {
      const control = active as HTMLInputElement;
      return { where, field: fieldsOf(scope).indexOf(control), sel: [control.selectionStart, control.selectionEnd] };
    }
    if (scope && active instanceof HTMLButtonElement) {
      return { where, button: [...scope.querySelectorAll("button")].indexOf(active) };
    }
    return { where, tag: active.tagName.toLowerCase() };
  }

  snapshot(): Omit<Snapshot, "renderError" | "unhandled" | "defaultPrevented" | "dataTransfer"> {
    const modal = this.modalRoot();
    return {
      ...scopeOf(this.host!),
      cards: this.cards().map((card) => this.cardFlags(card)),
      modal: modal ? scopeOf(modal) : null,
      focus: this.focusSnapshot(modal),
      calls: this.takeCalls(),
    };
  }
}

/** Mounts a fresh list for a recorded scenario and replays every step. */
export async function replayScenario(recording: Recording, scenario: Scenario) {
  const harness = new VariablesHarness(worldFor(recording, scenario), recording.worlds);
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
