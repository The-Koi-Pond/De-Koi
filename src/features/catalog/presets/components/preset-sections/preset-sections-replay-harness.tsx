// Replays the black-box recordings (test-fixtures/README.md) against the tab: the page wrapper the README shows (the
// real preset and agent hooks in a fresh QueryClient without retries, the tab's mutations logged), the recorder's
// fakes at the API boundary (the spec files install them with `vi.mock`, see `fake-preset-sections-apis.ts`), the
// faked `Date`, the manual timer clock, queued animation frames and the fake `localStorage`. Steps, settling and the
// snapshot follow the README.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import {
  presetKeys,
  useCreateGroup,
  useCreateSection,
  useCreateVariable,
  useDeleteGroup,
  useDeleteSection,
  useDeleteVariable,
  usePresetFull,
  useReorderSections,
  useReorderVariables,
  useUpdateGroup,
  useUpdateSection,
  useUpdateVariable,
} from "../../hooks/use-presets";
import type { ChoiceBlockRow } from "../preset-variables/variable-row";
import { fakeLocalStorage, fakePresetSectionsApis, type Op, type World } from "./fake-preset-sections-apis";
import { PresetSectionsTab } from "./PresetSectionsTab";
import { isOn, LOREBOOK_MARKER_TYPES, readMarkerConfig, type SectionRow } from "./section-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Step = [string, ...unknown[]];

export type FieldSnapshot = Record<string, unknown> & { tag: string };
export type ButtonSnapshot = Record<string, unknown> & { text: string };
export type LabelledSnapshot = Record<string, unknown> & { tag: string; text: string };

export interface ScopeSnapshot {
  text: string;
  fields: FieldSnapshot[];
  buttons: ButtonSnapshot[];
  labelled: LabelledSnapshot[];
}

export type CardFlag = "expanded" | "chevronDown" | "off" | "dragging" | "lineBefore" | "lineAfter";
export type OpenPart = "addMenu" | "groupsPanel" | "lorebookWarning" | "groupRename";

export type FocusSnapshot = { where: "tab" | "dialog" | "other"; dialog?: number } & (
  { field: number; sel: [number | null, number | null] | null } | { button: number } | { tag: string }
);

export interface DataTransferSnapshot {
  effectAllowed: string;
  dropEffect: string;
  data: Record<string, string>;
}

export interface Snapshot extends ScopeSnapshot {
  cards: CardFlag[][];
  open: OpenPart[];
  modals: ScopeSnapshot[];
  focus: FocusSnapshot | null;
  calls: unknown[];
  renderError?: string[];
  eventError?: string[];
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
  open?: number;
  modals?: number;
  focus?: FocusSnapshot | null;
  calls: unknown[];
  error?: string;
  renderError?: string[];
  eventError?: string[];
  unhandled?: string[];
  defaultPrevented?: boolean;
  dataTransfer?: DataTransferSnapshot | null;
  unhandledAfterUnmount?: string[];
}

type WorldKind = "sections" | "groups" | "variables" | "agents" | "preset" | "storage" | "lore";

export interface Scenario {
  id: string;
  world: Partial<Record<WorldKind, string>>;
  pre: Step[];
  steps: RecordedStep[];
}

type Rows = Array<Record<string, unknown> & { id: string }>;

export interface Recording {
  format: number;
  defaultWorld: Record<WorldKind, string>;
  worlds: {
    sections: Record<string, Rows>;
    groups: Record<string, Rows>;
    variables: Record<string, Rows>;
    agents: Record<string, Rows>;
    preset: Record<string, Record<string, unknown>>;
    preset2: Record<string, unknown>;
    preset2Sections: Rows;
    storage: Record<string, World["storage"]>;
    lore: Record<string, boolean>;
  };
  pool: unknown[];
  scenarios: Scenario[];
}

const PRESET_ID = "preset-1";
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
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

/** The recorded step with its pooled values filled in. */
export function resolveStep(recording: Recording, recorded: RecordedStep): StepResult {
  if (recorded.error !== undefined) return { step: recorded.step, error: recorded.error, calls: recorded.calls };
  const { text, fields, buttons, labelled, cards, open, modals, ...rest } = recorded;
  return {
    ...rest,
    text: recording.pool[text!] as string,
    fields: recording.pool[fields!] as FieldSnapshot[],
    buttons: recording.pool[buttons!] as ButtonSnapshot[],
    labelled: recording.pool[labelled!] as LabelledSnapshot[],
    cards: recording.pool[cards!] as CardFlag[][],
    open: recording.pool[open!] as OpenPart[],
    modals: recording.pool[modals!] as ScopeSnapshot[],
    focus: recorded.focus ?? null,
  };
}

function worldSet<T>(sets: Record<string, T>, name: string, kind: string): T {
  const set = sets[name];
  if (set === undefined) throw new Error(`No ${kind} set ${name}`);
  return decode(set) as T;
}

export interface ScenarioWorld {
  world: World;
  lore: boolean;
}

export function worldFor(recording: Recording, scenario: Pick<Scenario, "world">): ScenarioWorld {
  const pick = (kind: WorldKind) => scenario.world[kind] ?? recording.defaultWorld[kind];
  const { worlds } = recording;
  const sections = worldSet(worlds.sections, pick("sections"), "sections");
  const groups = worldSet(worlds.groups, pick("groups"), "groups");
  const variables = worldSet(worlds.variables, pick("variables"), "variables");
  const preset = worldSet(worlds.preset, pick("preset"), "preset") as Record<string, unknown> & { id: string };
  const ids = (rows: Rows) => rows.map((row) => row.id);
  for (const [key, rows] of [
    ["sectionOrder", sections],
    ["groupOrder", groups],
    ["variableOrder", variables],
  ] as const) {
    if (preset[key] === "$ids") preset[key] = ids(rows);
  }
  if (preset.sectionOrder === "$partial") preset.sectionOrder = [...ids(sections).reverse().slice(0, -1), "s-missing"];
  return {
    world: {
      sections: [...sections, ...(decode(worlds.preset2Sections) as Rows)],
      groups,
      variables,
      agents: worldSet(worlds.agents, pick("agents"), "agents"),
      presets: [preset, decode(worlds.preset2) as Record<string, unknown> & { id: string }],
      storage: worldSet(worlds.storage, pick("storage"), "storage"),
    },
    lore: worldSet(worlds.lore, pick("lore"), "lore"),
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
      fakePresetSectionsApis.record([kind, name, structuredClone(args[0] as unknown)]);
      return run(...args);
    };
  return {
    ...mutation,
    mutate: call("mutate", mutation.mutate),
    mutateAsync: call("mutateAsync", mutation.mutateAsync),
  };
}

/** True when an enabled marker row is a lorebook marker (how the editor works out `hasLorebookMarker`). */
function isEnabledLorebookMarker(section: SectionRow): boolean {
  if (!isOn(section.enabled) || !isOn(section.isMarker)) return false;
  const config = readMarkerConfig(section.markerConfig);
  return !!config && LOREBOOK_MARKER_TYPES.includes(config.type);
}

/** Lets steps change the page's state from outside. */
interface PageControls {
  setPresetId: (id: string) => void;
  setLore: (lore: boolean) => void;
}

/** How the real preset editor feeds the tab. */
function Page({ initialLore, controls }: { initialLore: boolean; controls: Partial<PageControls> }) {
  const [presetId, setPresetId] = useState(PRESET_ID);
  const [parentChatHasLorebook, setLore] = useState(initialLore);
  controls.setPresetId = setPresetId;
  controls.setLore = setLore;
  const { data } = usePresetFull(presetId);
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const reorderSections = useReorderSections();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const createVariable = useCreateVariable();
  const updateVariable = useUpdateVariable();
  const deleteVariable = useDeleteVariable();
  const reorderVariables = useReorderVariables();
  const sectionOrder = useMemo(
    () => (Array.isArray(data?.preset?.sectionOrder) ? (data.preset.sectionOrder as string[]) : []),
    [data],
  );
  const sections = useMemo(() => {
    const byId = new Map((data?.sections ?? []).map((section) => [section.id, section]));
    return sectionOrder.map((id) => byId.get(id)).filter(Boolean) as unknown as SectionRow[];
  }, [data?.sections, sectionOrder]);
  const hasLorebookMarker = useMemo(() => sections.some(isEnabledLorebookMarker), [sections]);
  const groupMap = useMemo(() => new Map((data?.groups ?? []).map((group) => [group.id, group])), [data?.groups]);
  const choiceBlocks = useMemo(() => (data?.choiceBlocks ?? []) as ChoiceBlockRow[], [data?.choiceBlocks]);
  if (!data) return null;
  return (
    <PresetSectionsTab
      presetId={presetId}
      sections={sections}
      groupMap={groupMap}
      choiceBlocks={choiceBlocks}
      wrapFormat="xml"
      onCreateSection={logged("createSection", createSection)}
      onUpdateSection={logged("updateSection", updateSection)}
      onDeleteSection={logged("deleteSection", deleteSection)}
      onReorderSections={logged("reorderSections", reorderSections)}
      onCreateGroup={logged("createGroup", createGroup)}
      onUpdateGroup={logged("updateGroup", updateGroup)}
      onDeleteGroup={logged("deleteGroup", deleteGroup)}
      onCreateVariable={logged("createVariable", createVariable)}
      onUpdateVariable={logged("updateVariable", updateVariable)}
      onDeleteVariable={logged("deleteVariable", deleteVariable)}
      onReorderVariables={logged("reorderVariables", reorderVariables)}
      hasLorebookMarker={hasLorebookMarker}
      parentChatHasLorebook={parentChatHasLorebook}
    />
  );
}

// ── Harness ───────────────────────────────────────────────────────────────────

class ControlNotFound extends Error {}

const collapse = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

const FIELD_SELECTOR = "input, textarea, select";
const CARD_SELECTOR = "[data-section-index]";

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

function fieldSnapshot(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): FieldSnapshot {
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

function scopeOf(root: Element): ScopeSnapshot {
  return {
    text: textOf(root),
    fields: fieldsOf(root).map(fieldSnapshot),
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
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: collapse(element.textContent),
        ...describedAttributes(element),
      })),
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

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;

/** Card n (anything inside it, and its wrapper in the list) measures `{ top: 100n, height: 100, … }`. */
function installCardLayout() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const card = this.closest(CARD_SELECTOR) ?? this.querySelector(`:scope > ${CARD_SELECTOR}`);
    if (!card) return realGetBoundingClientRect.call(this);
    const top = 100 * Number(card.getAttribute("data-section-index"));
    return { top, height: 100, bottom: top + 100, left: 0, width: 600, right: 600, x: 0, y: top } as DOMRect;
  };
}

export class SectionsHarness {
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
  private dataTransfer: FakeDataTransfer | null = null;
  private readonly controls: Partial<PageControls> = {};
  private readonly otherRejectionListeners: NodeJS.UnhandledRejectionListener[];
  private readonly worldSets: Recording["worlds"] | null;
  private readonly lore: boolean;
  private presetId = PRESET_ID;
  private readonly onUnhandled = (reason: unknown) => {
    this.unhandled.push(messageOf(reason));
  };
  private readonly onWindowError = (event: ErrorEvent) => {
    event.preventDefault();
    const error = event.error as Error | undefined;
    this.eventErrors.push(error ? `${error.name}: ${error.message}` : event.message);
  };

  constructor({ world, lore }: ScenarioWorld, worldSets: Recording["worlds"] | null = null) {
    fakePresetSectionsApis.reset(world);
    this.worldSets = worldSets;
    this.lore = lore;
    this.clock.install();
    installCardLayout();
    vi.stubGlobal("localStorage", fakeLocalStorage);
    window.addEventListener("error", this.onWindowError);
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
          <Page initialLore={this.lore} controls={this.controls} />
        </QueryClientProvider>,
      );
    });
    await this.settle();
  }

  /** Releases held ops, unmounts, empties the page and returns rejections that came after unmounting. */
  async unmount(): Promise<string[]> {
    fakePresetSectionsApis.releaseAll();
    await this.guarded(() => this.root?.unmount());
    this.host?.remove();
    document.body.replaceChildren();
    const before = this.unhandled.length;
    for (let round = 0; round < 4; round += 1) await new Promise((resolve) => realSetTimeout(resolve, 0));
    const after = this.unhandled.slice(before);
    this.queryClient.clear();
    this.clock.uninstall();
    Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.removeEventListener("error", this.onWindowError);
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

  private inCard<T extends HTMLElement = HTMLElement>(n: number, selector: string, what: string): T {
    const found = this.card(n).querySelector<T>(selector);
    if (!found) throw new ControlNotFound(`no ${what} in card #${n}`);
    return found;
  }

  chevron(n: number): HTMLButtonElement {
    return this.inCard(n, "button[aria-expanded]", "chevron");
  }

  /** The name follows the chevron and the role icon. */
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
    const list = this.host!.querySelector<HTMLElement>("[data-section-list]");
    if (!list) throw new ControlNotFound("no list");
    return list;
  }

  /** The dialogs in `document.body`, in the order added. */
  modalRoots(): HTMLElement[] {
    return [...document.body.children].filter(
      (child): child is HTMLElement => child !== this.host && !!child.querySelector('[role="dialog"]'),
    );
  }

  private modal(): HTMLElement {
    const modal = this.modalRoots().at(-1);
    if (!modal) throw new ControlNotFound("no dialog");
    return modal;
  }

  buttonWithText(text: string, root: Element = this.host!, index = 0): HTMLButtonElement {
    const found = [...root.querySelectorAll("button")].filter((button) => collapse(button.textContent) === text)[index];
    if (!found) throw new ControlNotFound(`no button "${text}" #${index}`);
    return found;
  }

  private groupRow(i: number): HTMLElement {
    const row = this.host!.querySelectorAll<HTMLElement>("[data-group-row]")[i];
    if (!row) throw new ControlNotFound(`no group row #${i}`);
    return row;
  }

  private labelledSelect(n: number, label: string, what: string): HTMLSelectElement {
    const found = [...this.card(n).querySelectorAll("select")].find((select) =>
      [...select.labels].some((element) => collapse(element.textContent) === label),
    );
    if (!found) throw new ControlNotFound(`no ${what} in card #${n}`);
    return found;
  }

  field(name: string): HTMLElement {
    if (name === "body") return document.body;
    if (name === "editor") {
      const area = this.modal().querySelector("textarea");
      if (!area) throw new ControlNotFound("no editor text area");
      return area;
    }
    if (name === "groupName") {
      const input = this.host!.querySelector<HTMLElement>("[data-group-row] input");
      if (!input) throw new ControlNotFound("no group name input");
      return input;
    }
    const [kind, at] = name.split(":");
    const n = Number(at);
    switch (kind) {
      case "name":
        return this.inCard(n, 'input[placeholder="Section name"]', "name input");
      case "role":
        return this.inCard(n, 'select[aria-label="Role"]', "role dropdown");
      case "content":
        return this.inCard(n, "textarea", "content text area");
      case "position":
        return this.labelledSelect(n, "Position:", "position dropdown");
      case "depth":
        return this.inCard(n, 'input[inputmode="numeric"]', "depth box");
      case "group":
        return this.labelledSelect(n, "Group:", "group dropdown");
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

  async setValue(control: HTMLElement, value: string, event: "input" | "change") {
    const prototype = Object.getPrototypeOf(control) as object;
    await this.guarded(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
      control.dispatchEvent(new Event(event, { bubbles: true }));
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
    if (type === "dragstart" || !this.dataTransfer) this.dataTransfer = newDataTransfer();
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

  private worldRows(set: string) {
    const rows = this.worldSets?.sections[set];
    if (rows === undefined) throw new Error(`No sections set ${set}`);
    return decode(rows) as Array<Record<string, unknown> & { id: string }>;
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
      case "duplicate":
        await this.click(this.inCard(num(0), 'button[title="Duplicate"]', "Duplicate button"));
        return {};
      case "eye":
        await this.click(this.inCard(num(0), 'button[title="Disable"], button[title="Enable"]', "eye button"));
        return {};
      case "deleteSection":
        await this.click(this.inCard(num(0), 'button[title="Delete"]', "trash button"));
        return {};
      case "addSection":
        await this.click(this.buttonWithText("Add Section"));
        return {};
      case "menuItem":
        await this.click(this.buttonWithText(str(0), this.host!, (args[1] as number | undefined) ?? 0));
        return {};
      case "menuBackdrop": {
        const catcher = this.host!.querySelector("[data-click-catcher]");
        if (!catcher) throw new ControlNotFound("no click-catcher");
        await this.click(catcher);
        return {};
      }
      case "groups": {
        const button = [...this.host!.querySelectorAll("button")].find((candidate) =>
          collapse(candidate.textContent).startsWith("Groups ("),
        );
        if (!button) throw new ControlNotFound("no Groups button");
        await this.click(button);
        return {};
      }
      case "newGroup":
        await this.click(this.buttonWithText("New Group"));
        return {};
      case "renameGroup": {
        const name = this.groupRow(num(0)).querySelector('[title="Click to rename"]');
        if (!name) throw new ControlNotFound(`no group name in row #${num(0)}`);
        await this.click(name);
        return {};
      }
      case "groupDelete": {
        const trash = [...this.groupRow(num(0)).querySelectorAll("button")].at(-1);
        if (!trash) throw new ControlNotFound(`no trash in group row #${num(0)}`);
        await this.click(trash);
        return {};
      }
      case "dismissWarning": {
        const dismiss = this.host!.querySelector('button[title="Dismiss warning"]');
        if (!dismiss) throw new ControlNotFound("no dismiss button");
        await this.click(dismiss);
        return {};
      }
      case "expandEditor":
        await this.click(this.inCard(num(0), 'button[title="Expand editor"]', "Expand editor button"));
        return {};
      case "macros":
        await this.click(this.inCard(num(0), 'button[title="Macros reference"]', "Macros reference button"));
        return {};
      case "close": {
        const close = this.modal().querySelector('button[aria-label="Close"]');
        if (!close) throw new ControlNotFound("no close button");
        await this.click(close);
        return {};
      }
      case "done":
        await this.click(this.buttonWithText("Done", this.modal()));
        return {};
      case "closeText":
        await this.click(this.buttonWithText("Close", this.modal()));
        return {};
      case "backdrop": {
        const backdrop = this.modal().firstElementChild;
        if (!backdrop || backdrop.matches('[role="dialog"]')) throw new ControlNotFound("no backdrop");
        await this.click(backdrop);
        return {};
      }
      case "focus":
        await this.focus(this.field(str(0)));
        return {};
      case "blur":
        await this.blur(this.field(str(0)));
        return {};
      case "type":
        await this.setValue(this.field(str(0)), str(1), "input");
        return {};
      case "choose":
        await this.setValue(this.field(str(0)), str(1), "change");
        return {};
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
      case "switchPreset":
        this.presetId = str(0);
        await this.afterAct(() => this.controls.setPresetId?.(str(0)));
        return {};
      case "setLore":
        await this.afterAct(() => this.controls.setLore?.(args[0] as boolean));
        return {};
      case "confirm":
        fakePresetSectionsApis.answerConfirm(args[0] as boolean);
        await this.settle();
        return {};
      case "fail":
        fakePresetSectionsApis.failNext(str(0) as Op, str(1));
        await this.settle();
        return {};
      case "hold":
        fakePresetSectionsApis.hold(str(0) as Op);
        await this.settle();
        return {};
      case "release":
        await this.afterAct(() => fakePresetSectionsApis.release(str(0) as Op));
        return {};
      case "createNoId":
        fakePresetSectionsApis.createNoId(str(0) as "sections");
        await this.settle();
        return {};
      case "patchSection":
        fakePresetSectionsApis.patchSection(str(0), decode(args[1]) as Record<string, unknown>);
        await this.settle();
        return {};
      case "setSections":
        fakePresetSectionsApis.setSections(this.worldRows(str(0)));
        await this.settle();
        return {};
      case "refetch":
        await this.afterAct(() => this.queryClient.invalidateQueries({ queryKey: presetKeys.full(this.presetId) }));
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
    const calls = fakePresetSectionsApis.calls.slice(this.seenCalls);
    this.seenCalls = fakePresetSectionsApis.calls.length;
    return calls.map((call) => encode(call));
  }

  /** The flags the recorder noted per card. */
  private cardFlags(card: HTMLElement): CardFlag[] {
    const flags: CardFlag[] = [];
    if (card.querySelector('input[placeholder="Section name"]')) flags.push("expanded");
    if (card.querySelector("button[aria-expanded] svg.lucide-chevron-down")) flags.push("chevronDown");
    if (card.classList.contains("opacity-50")) flags.push("off");
    if (card.classList.contains("opacity-40")) flags.push("dragging");
    const wrapper = card.parentElement!;
    if (wrapper.querySelector(':scope > [data-drop-line="before"]')) flags.push("lineBefore");
    if (wrapper.querySelector(':scope > [data-drop-line="after"]')) flags.push("lineAfter");
    return flags;
  }

  private openParts(): OpenPart[] {
    const host = this.host!;
    const open: OpenPart[] = [];
    if (host.querySelector("[data-click-catcher]")) open.push("addMenu");
    if ([...host.querySelectorAll("button")].some((button) => collapse(button.textContent) === "New Group")) {
      open.push("groupsPanel");
    }
    if (host.querySelector('button[title="Dismiss warning"]')) open.push("lorebookWarning");
    if (host.querySelector("[data-group-row] input")) open.push("groupRename");
    return open;
  }

  private focusSnapshot(modals: HTMLElement[]): FocusSnapshot | null {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const dialog = modals.findIndex((modal) => modal.contains(active));
    const scope = this.host!.contains(active) ? this.host! : dialog >= 0 ? modals[dialog]! : null;
    const place =
      scope === this.host
        ? { where: "tab" as const }
        : scope
          ? { where: "dialog" as const, dialog }
          : { where: "other" as const };
    if (scope && active.matches(FIELD_SELECTOR)) {
      const control = active as HTMLInputElement;
      const sel: [number | null, number | null] | null =
        active instanceof HTMLSelectElement ? null : [control.selectionStart, control.selectionEnd];
      return { ...place, field: fieldsOf(scope).indexOf(control), sel };
    }
    if (scope && active instanceof HTMLButtonElement) {
      return { ...place, button: [...scope.querySelectorAll("button")].indexOf(active) };
    }
    return { ...place, tag: active.tagName.toLowerCase() };
  }

  snapshot(): Omit<Snapshot, "renderError" | "eventError" | "unhandled" | "defaultPrevented" | "dataTransfer"> {
    const modals = this.modalRoots();
    return {
      ...scopeOf(this.host!),
      cards: this.cards().map((card) => this.cardFlags(card)),
      open: this.openParts(),
      modals: modals.map(scopeOf),
      focus: this.focusSnapshot(modals),
      calls: this.takeCalls(),
    };
  }
}

/** Mounts a fresh tab for a recorded scenario and replays every step. */
export async function replayScenario(recording: Recording, scenario: Scenario) {
  const harness = new SectionsHarness(worldFor(recording, scenario), recording.worlds);
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
