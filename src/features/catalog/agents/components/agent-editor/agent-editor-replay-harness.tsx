// Replays the black-box recordings (test-fixtures/README.md) against the editor: the real UI store, the
// real hooks in a fresh QueryClient without retries, and the recorder's fakes at the API boundary, which the
// spec files install with `vi.mock` (see `fake-agent-editor-apis.ts`). Steps, settling, the virtual flash
// clock and the snapshot follow the README exactly.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { AgentEditor } from "./AgentEditor";
import { fakeAgentEditorApis, type World } from "./fake-agent-editor-apis";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Step = [string, ...unknown[]];

export type FieldSnapshot = Record<string, unknown> & { tag: string };
export type ButtonSnapshot = Record<string, unknown> & { text: string };

export interface Snapshot {
  text: string;
  fields: FieldSnapshot[];
  buttons: ButtonSnapshot[];
  help: string[];
  store: { agentDetailId: string | null; editorDirty: boolean };
  calls: unknown[];
  /**
   * Not recorded: what each button shows as its on/off state (a ToggleRight/ToggleLeft icon, or a row's check
   * mark), `null` for buttons that show none. The replay checks the decision 1 `aria-pressed` values against it.
   */
  shownOn?: Array<boolean | null>;
  renderError?: string[];
  unhandled?: string[];
  defaultPrevented?: boolean;
  unhandledAfterUnmount?: string[];
}

/** A recorded step result with its pooled values resolved. */
export type StepResult = { step: Step } & (Snapshot | { error: string; calls: unknown[] });

interface RecordedStep {
  step: Step;
  text?: number;
  fields?: number;
  buttons?: number;
  help?: number;
  store?: Snapshot["store"];
  calls: unknown[];
  error?: string;
  renderError?: string[];
  unhandled?: string[];
  defaultPrevented?: boolean;
  unhandledAfterUnmount?: string[];
}

export interface Scenario {
  id: string;
  detailId: string | null;
  world: Partial<Record<keyof World, string>>;
  pre: Step[];
  steps: RecordedStep[];
}

export interface Recording {
  format: number;
  defaultWorld: Record<keyof World, string>;
  worlds: { [K in keyof World]: Record<string, unknown> };
  pool: unknown[];
  scenarios: Scenario[];
}

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
  if (isTag(record, "$file")) {
    const { name, size, type } = record.$file as { name: string; size: number; type: string };
    return new File(["x".repeat(size)], name, { type });
  }
  if (isTag(record, "$error")) return new Error(String(record.$error));
  if (isTag(record, "$function")) return () => undefined;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decode(item)]));
}

/** Encodes a value the way the recorder wrote calls, keeping key order. */
function encode(value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) };
  if (typeof value === "function") return { $function: true };
  if (value instanceof File) return { $file: { name: value.name, size: value.size, type: value.type } };
  if (value instanceof Error) return { $error: value.message };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

/** The recorded step with its pooled `text`, `fields`, `buttons` and `help` filled in. */
export function resolveStep(recording: Recording, recorded: RecordedStep): StepResult {
  if (recorded.error !== undefined) return { step: recorded.step, error: recorded.error, calls: recorded.calls };
  const { text, fields, buttons, help, ...rest } = recorded;
  return {
    ...rest,
    text: recording.pool[text!] as string,
    fields: recording.pool[fields!] as FieldSnapshot[],
    buttons: recording.pool[buttons!] as ButtonSnapshot[],
    help: recording.pool[help!] as string[],
    store: recorded.store!,
  };
}

export function worldFor(recording: Recording, scenario: Scenario): World {
  const pick = <K extends keyof World>(kind: K): World[K] => {
    const name = scenario.world[kind] ?? recording.defaultWorld[kind];
    const set = recording.worlds[kind][name];
    if (set === undefined) throw new Error(`No ${kind} set ${name}`);
    return decode(set) as World[K];
  };
  return {
    agents: pick("agents"),
    connections: pick("connections"),
    lorebooks: pick("lorebooks"),
    entries: pick("entries"),
    tools: pick("tools"),
    capabilities: pick("capabilities"),
    knowledge: pick("knowledge"),
  };
}

// ── Clock ─────────────────────────────────────────────────────────────────────

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const FLASH_MS = 1500;

interface VirtualTimer {
  due: number;
  order: number;
  run: () => void;
}

/** Puts `setTimeout(fn, 1500)` (the Saved flash) on a virtual clock that only `wait` steps move. */
class FlashClock {
  now = 0;
  private order = 0;
  readonly timers = new Map<object, VirtualTimer>();

  install() {
    const timers = this.timers;
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== FLASH_MS || typeof handler !== "function") return realSetTimeout(handler, delay, ...args);
      const id = {};
      this.order += 1;
      timers.set(id, { due: this.now + FLASH_MS, order: this.order, run: () => handler(...args) });
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: unknown) => {
      if (typeof id === "object" && id !== null && timers.has(id)) timers.delete(id);
      else realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
    }) as typeof clearTimeout;
  }

  uninstall() {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    this.timers.clear();
  }

  /** The next timer due by `until`, removed from the queue. */
  takeDue(until: number): VirtualTimer | null {
    let next: [object, VirtualTimer] | null = null;
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

const FIELD_ATTRIBUTES = ["min", "max", "rows", "accept", "inputmode"] as const;

function describedAttributes(element: Element): Record<string, string> {
  const named: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith("aria-") || attribute.name === "title") named[attribute.name] = attribute.value;
  }
  return named;
}

/** The on/off state a button shows: its toggle icon, or (a selectable row) whether its box has a check. */
function shownOn(button: HTMLButtonElement): boolean | null {
  if (button.querySelector("svg.lucide-toggle-right")) return true;
  if (button.querySelector("svg.lucide-toggle-left")) return false;
  if (button.closest("section")?.querySelector("ul") && button.closest("ul > li")) {
    return !!button.querySelector("svg.lucide-check");
  }
  return null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export class EditorHarness {
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  private root: Root | null = null;
  private host: HTMLDivElement | null = null;
  private seenCalls = 0;
  private readonly clock = new FlashClock();
  private renderErrors: unknown[] = [];
  private unhandled: string[] = [];
  private readonly otherRejectionListeners: NodeJS.UnhandledRejectionListener[];
  private uuid = 0;
  private readonly onUnhandled = (reason: unknown) => {
    this.unhandled.push(messageOf(reason));
  };

  constructor(world: World, detailId: string | null) {
    fakeAgentEditorApis.reset(world);
    useUIStore.setState({ agentDetailId: detailId, editorDirty: false });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      this.uuid += 1;
      return `00000000-0000-4000-8000-${String(this.uuid).padStart(12, "0")}`;
    });
    this.clock.install();
    // The old editor left some rejections unhandled on purpose (they are part of the recording); collect them
    // here instead of letting the test runner report them.
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

  /** 8 rounds of `act` and a real `setTimeout(0)`, as the recorder settled after each step. */
  async settle() {
    for (let round = 0; round < 8; round += 1) {
      await this.guarded(() => new Promise<void>((resolve) => realSetTimeout(resolve, 0)));
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
          <AgentEditor />
        </QueryClientProvider>,
      );
    });
    await this.settle();
  }

  /** Releases held ops, unmounts and returns rejections that came after unmounting. */
  async unmount(): Promise<string[]> {
    fakeAgentEditorApis.releaseAll();
    await this.guarded(() => this.root?.unmount());
    this.host?.remove();
    const before = this.unhandled.length;
    for (let round = 0; round < 4; round += 1) await new Promise((resolve) => realSetTimeout(resolve, 0));
    const after = this.unhandled.slice(before);
    this.queryClient.clear();
    this.clock.uninstall();
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.off("unhandledRejection", this.onUnhandled);
    for (const listener of this.otherRejectionListeners) process.on("unhandledRejection", listener);
    return after;
  }

  get element(): HTMLElement {
    return this.host!;
  }

  // ── Locators ──

  buttons(): HTMLButtonElement[] {
    return [...this.host!.querySelectorAll("button")];
  }

  private controls(): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
    return [...this.host!.querySelectorAll<HTMLInputElement>("input, textarea, select")];
  }

  /** The deepest elements whose whole text is `text` (not controls or options). */
  private textElements(text: string): HTMLElement[] {
    return [...this.host!.querySelectorAll<HTMLElement>("*")].filter(
      (element) =>
        !element.matches("input, textarea, select, option, button") &&
        collapse(element.textContent) === text &&
        ![...element.children].some((child) => collapse(child.textContent) === text),
    );
  }

  /** The control that follows the visible text `label` most closely. */
  labelled(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    const controls = this.controls();
    for (const element of this.textElements(label)) {
      const next = controls.find(
        (control) => element.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      if (next) return next;
    }
    throw new ControlNotFound(`no control labelled "${label}" #0`);
  }

  placeholder(text: string): HTMLInputElement | HTMLTextAreaElement {
    const found = this.controls().find((control) => control.getAttribute("placeholder") === text);
    if (!found || found instanceof HTMLSelectElement)
      throw new ControlNotFound(`no field with placeholder "${text}" #0`);
    return found;
  }

  button(text: string): HTMLButtonElement {
    const found = this.buttons().find((button) => collapse(button.textContent) === text);
    if (!found) throw new ControlNotFound(`no button "${text}" #0`);
    return found;
  }

  buttonLabelled(label: string): HTMLButtonElement {
    const found = this.buttons().find((button) => button.getAttribute("aria-label") === label);
    if (!found) throw new ControlNotFound(`no button labelled "${label}" #0`);
    return found;
  }

  /** The block under a group title. */
  group(title: string): HTMLElement {
    for (const element of this.textElements(title)) {
      const section = element.closest("section");
      if (section) return section;
    }
    throw new ControlNotFound(`no group "${title}"`);
  }

  /** A group's buttons, without its help button. */
  groupButtons(title: string): HTMLButtonElement[] {
    return [...this.group(title).querySelectorAll("button")].filter(
      (button) => !(button.getAttribute("aria-label") ?? "").startsWith("Help:"),
    );
  }

  /** The row's name line: the first line of its text block (after the checkbox square). */
  private static rowName(row: Element | null | undefined): string {
    return row?.children[1]?.children[0]?.textContent ?? "";
  }

  /** The Knowledge Sources rows: lorebook rows are list items without a trash button, file rows with one. */
  private knowledgeRows(files: boolean): HTMLLIElement[] {
    return [...this.group("Knowledge Sources").querySelectorAll<HTMLLIElement>("ul > li")].filter(
      (row) => !!row.querySelector('button[title="Delete file"]') === files,
    );
  }

  lorebookRow(name: string): HTMLButtonElement {
    const found = this.knowledgeRows(false)
      .map((row) => row.querySelector("button")!)
      .find((row) => EditorHarness.rowName(row) === name);
    if (!found) throw new ControlNotFound(`no lorebook row "${name}"`);
    return found;
  }

  fileRow(name: string): HTMLLIElement {
    const found = this.knowledgeRows(true).find((row) => EditorHarness.rowName(row.querySelector("button")) === name);
    if (!found) throw new ControlNotFound(`no file row "${name}"`);
    return found;
  }

  /** A tool card by the name in its header (the header's `code`). */
  toolCard(name: string): HTMLLIElement {
    const found = [...this.group("Tools / Function Calling").querySelectorAll<HTMLLIElement>("ul > li")].find(
      (card) => card.querySelectorAll("button")[1]?.querySelector("code")?.textContent === name,
    );
    if (!found) throw new ControlNotFound(`no tool card "${name}"`);
    return found;
  }

  fileInput(): HTMLInputElement {
    const found = this.host!.querySelector<HTMLInputElement>('input[type="file"]');
    if (!found) throw new ControlNotFound("no file input");
    return found;
  }

  // ── Events ──

  async click(element: Element) {
    await this.guarded(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await this.settle();
  }

  async setValue(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, event: string) {
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

  async key(control: HTMLElement, key: string): Promise<boolean> {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await this.guarded(() => {
      control.dispatchEvent(event);
    });
    await this.settle();
    return event.defaultPrevented;
  }

  async pickFiles(files: File[]) {
    const input = this.fileInput();
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await this.guarded(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await this.settle();
  }

  async wait(ms: number) {
    const until = this.clock.now + ms;
    for (let timer = this.clock.takeDue(until); timer; timer = this.clock.takeDue(until)) {
      this.clock.now = timer.due;
      await this.guarded(() => timer.run());
      await this.settle();
    }
    this.clock.now = until;
    await this.settle();
  }

  /** Runs one recorded step; returns `defaultPrevented` for `key` steps. */
  async run(step: Step): Promise<boolean | undefined> {
    const [kind, ...args] = step;
    const arg = (index: number) => args[index] as string;
    switch (kind) {
      case "mount":
        return void (await this.mount());
      case "typePh":
        return void (await this.setValue(this.placeholder(arg(0)), arg(1), "input"));
      case "type":
        return void (await this.setValue(this.labelled(arg(0)), arg(1), "input"));
      case "select":
        return void (await this.setValue(this.labelled(arg(0)), arg(1), "change"));
      case "focus":
        return void (await this.focus(this.labelled(arg(0))));
      case "blur":
        return void (await this.blur(this.labelled(arg(0))));
      case "key":
        return this.key(this.labelled(arg(0)), arg(1));
      case "check": {
        const label = [...this.host!.querySelectorAll("label")].find(
          (element) => collapse(element.textContent) === arg(0),
        );
        const box = label?.querySelector('input[type="checkbox"]');
        if (!box) throw new ControlNotFound(`no checkbox "${arg(0)}"`);
        return void (await this.click(box));
      }
      case "click":
        return void (await this.click(this.button(arg(0))));
      case "clickLabel":
        return void (await this.click(this.buttonLabelled(arg(0))));
      case "toggle": {
        const first = this.groupButtons(arg(0))[0];
        if (!first) throw new ControlNotFound(`no button in group "${arg(0)}"`);
        return void (await this.click(first));
      }
      case "groupButton": {
        const found = this.groupButtons(arg(0)).find((button) => collapse(button.textContent).startsWith(arg(1)));
        if (!found) throw new ControlNotFound(`no button "${arg(1)}" in group "${arg(0)}"`);
        return void (await this.click(found));
      }
      case "chatActive": {
        const found = this.buttons().find((button) =>
          (button.getAttribute("aria-label") ?? "").startsWith("Use this chat's active lorebooks:"),
        );
        if (!found) throw new ControlNotFound("no chat-active toggle");
        return void (await this.click(found));
      }
      case "pickLorebook":
        return void (await this.click(this.lorebookRow(arg(0))));
      case "pickFile":
        return void (await this.click(this.fileRow(arg(0)).querySelector("button")!));
      case "deleteFile": {
        const trash = this.fileRow(arg(0)).querySelector('button[title="Delete file"]');
        if (!trash) throw new ControlNotFound(`no delete button for "${arg(0)}"`);
        return void (await this.click(trash));
      }
      case "upload": {
        const { name, size, type } = args[0] as { name: string; size: number; type: string };
        return void (await this.pickFiles([new File(["x".repeat(size)], name, { type })]));
      }
      case "uploadNone":
        return void (await this.pickFiles([]));
      case "clickUpload": {
        const found = this.buttons().find((button) =>
          ["Upload File", "Uploading..."].includes(collapse(button.textContent)),
        );
        if (!found) throw new ControlNotFound("no upload button");
        return void (await this.click(found));
      }
      case "toggleTool":
        return void (await this.click(this.toolCard(arg(0)).querySelectorAll("button")[0]!));
      case "expandTool":
        return void (await this.click(this.toolCard(arg(0)).querySelectorAll("button")[1]!));
      case "dismissError": {
        const dismiss = this.host!.querySelector<HTMLButtonElement>(".bg-red-500\\/10 button");
        if (!dismiss) throw new ControlNotFound("no save error banner");
        return void (await this.click(dismiss));
      }
      case "confirm":
        return void fakeAgentEditorApis.answerConfirm(args[0] as boolean);
      case "fileResult":
        return void fakeAgentEditorApis.setFileResult(args[0] as string | null | { throw: string });
      case "fail":
        return void fakeAgentEditorApis.failNext(arg(0) as never, arg(1));
      case "hold":
        return void fakeAgentEditorApis.hold(arg(0) as never);
      case "release":
        await this.guarded(() => fakeAgentEditorApis.release(arg(0) as never));
        return void (await this.settle());
      case "createNoId":
        return void fakeAgentEditorApis.createNoId();
      case "setWorld":
        return void fakeAgentEditorApis.setWorld(arg(0) as keyof World, this.worldSet(arg(0), arg(1)) as never);
      case "patchAgent":
        return void fakeAgentEditorApis.patchAgent(arg(0), decode(args[1]) as Record<string, unknown>);
      case "refetch":
        await this.guarded(() => this.queryClient.invalidateQueries({ queryKey: [arg(0)] }));
        return void (await this.settle());
      case "open":
        await this.guarded(() => {
          const ui = useUIStore.getState();
          if (args[0] === null) ui.closeAgentDetail();
          else ui.openAgentDetail(arg(0));
        });
        return void (await this.settle());
      case "wait":
        return void (await this.wait(args[0] as number));
      default:
        throw new Error(`Unknown step kind ${kind}`);
    }
  }

  private worldSets: Recording["worlds"] | null = null;

  useWorldSets(sets: Recording["worlds"]) {
    this.worldSets = sets;
  }

  private worldSet(kind: string, name: string): unknown {
    const set = this.worldSets?.[kind as keyof World]?.[name];
    if (set === undefined) throw new Error(`No ${kind} set ${name}`);
    return decode(set);
  }

  /** Runs a step and returns what the recorder would have recorded after it. */
  async record(step: Step): Promise<StepResult> {
    const errorsBefore = this.renderErrors.length;
    const unhandledBefore = this.unhandled.length;
    let defaultPrevented: boolean | undefined;
    try {
      defaultPrevented = await this.run(step);
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
      ...(step[0] === "key" ? { defaultPrevented } : {}),
    };
  }

  private takeCalls(): unknown[] {
    const calls = fakeAgentEditorApis.calls.slice(this.seenCalls);
    this.seenCalls = fakeAgentEditorApis.calls.length;
    return calls.map((call) => encode(call));
  }

  /** The page text without the text areas' text, whitespace collapsed. */
  text(): string {
    const walker = document.createTreeWalker(this.host!, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("textarea")) continue;
      text += node.nodeValue ?? "";
    }
    return collapse(text);
  }

  snapshot(): Omit<Snapshot, "renderError" | "unhandled" | "defaultPrevented"> {
    const host = this.host!;
    const { agentDetailId, editorDirty } = useUIStore.getState();
    return {
      text: this.text(),
      fields: this.controls().map((control) => {
        const base: FieldSnapshot =
          control instanceof HTMLSelectElement
            ? {
                tag: "select",
                value: control.value,
                selectedIndex: control.selectedIndex,
                options: [...control.options].map((option) => [option.value, collapse(option.textContent)]),
              }
            : {
                tag: control.tagName.toLowerCase(),
                type: control.type,
                placeholder: control.getAttribute("placeholder"),
                value: control.value,
                ...(control instanceof HTMLInputElement && control.type === "checkbox"
                  ? { checked: control.checked }
                  : {}),
                ...Object.fromEntries(
                  FIELD_ATTRIBUTES.filter((name) => control.hasAttribute(name)).map((name) => [
                    name,
                    control.getAttribute(name),
                  ]),
                ),
              };
        return { ...base, ...(control.disabled ? { disabled: true } : {}), ...describedAttributes(control) };
      }),
      buttons: this.buttons().map((button) => ({
        text: collapse(button.textContent),
        ...describedAttributes(button),
        ...(button.disabled ? { disabled: true } : {}),
      })),
      shownOn: this.buttons().map(shownOn),
      help: [...host.querySelectorAll<HTMLElement>("[data-help-text]")].map(
        (element) => element.getAttribute("data-help-text") ?? "",
      ),
      store: { agentDetailId, editorDirty },
      calls: this.takeCalls(),
    };
  }
}

/** Mounts a fresh editor for a recorded scenario, runs its setup steps and replays every step. */
export async function replayScenario(recording: Recording, scenario: Scenario) {
  const harness = new EditorHarness(worldFor(recording, scenario), scenario.detailId);
  harness.useWorldSets(recording.worlds);
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
