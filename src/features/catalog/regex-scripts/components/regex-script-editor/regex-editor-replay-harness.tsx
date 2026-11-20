// Replays the black-box recordings (test-fixtures/README.md) against the editor: the real UI store, the
// real hooks in a fresh QueryClient without retries, and the fake storage and confirm dialog, which the
// spec files install with `vi.mock` (see `fake-regex-storage.ts`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { fakeRegexStorage } from "./fake-regex-storage";
import { PATTERN_ERROR_RING } from "./PatternFields";
import { resetTrialWorker } from "./live-test";
import { RegexScriptEditor } from "./RegexScriptEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Stands in for the browser's Worker in Live Test's trial runs (jsdom has none). In "run" mode it really
 * runs the replace, on this thread (every recorded pattern is quick); in "hang" mode it never answers a
 * trial, like a pattern that backtracks catastrophically.
 */
export class FakeTrialWorker {
  static mode: "run" | "hang" = "run";
  static made: FakeTrialWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  jobs: { source: string; flags: string; text: string }[] = [];
  terminated = false;

  constructor() {
    FakeTrialWorker.made.push(this);
  }

  postMessage(job: { type?: string; id: number; source: string; flags: string; text: string }) {
    if (job.type !== "ready") {
      this.jobs.push({ source: job.source, flags: job.flags, text: job.text });
      if (FakeTrialWorker.mode === "hang") return;
      try {
        job.text.replace(new RegExp(job.source, job.flags), "");
      } catch {
        // The real worker answers either way.
      }
    }
    queueMicrotask(() => {
      if (!this.terminated) this.onmessage?.({ data: job.id });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

/** Picks how Live Test's trial runs behave: the stand-in worker in a mode, or no Worker at all. */
export function setTrialWorkers(mode: "run" | "hang" | "none") {
  resetTrialWorker();
  FakeTrialWorker.made = [];
  const scope = globalThis as { Worker?: unknown };
  if (mode === "none") {
    delete scope.Worker;
    return;
  }
  FakeTrialWorker.mode = mode;
  scope.Worker = FakeTrialWorker;
  if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "blob:trial-worker";
}

setTrialWorkers("run");

export type Step = [string, ...unknown[]];

interface InputSnapshot {
  tag: string;
  type: string;
  placeholder: string | null;
  value: string;
  invalid?: boolean;
}

export interface ButtonSnapshot {
  text: string;
  "aria-label"?: string;
  title?: string;
  "aria-pressed"?: string;
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean;
  icon?: string;
}

export interface Snapshot {
  text: string;
  inputs: InputSnapshot[];
  buttons: ButtonSnapshot[];
  result: string | null;
  patternError: string | null;
  store: { regexDetailId: string | null; editorDirty: boolean };
  calls: unknown[][];
}

export type StepResult = { step: Step } & (Snapshot | { error: string });

export interface Scenario {
  id: string;
  detailId: string | null;
  characters: unknown[];
  rows?: unknown;
  steps: StepResult[];
  unhandled: string[];
}

export interface Recording {
  format: number;
  rows: Array<Record<string, unknown> & { id: string }>;
  scenarios: Scenario[];
}

class ControlNotFound extends Error {}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const ERROR_RING_CLASS = PATTERN_ERROR_RING.split(" ")[0]!;
const FIND_PLACEHOLDER = "e.g. \\\\*([^*]+)\\\\*";

export class EditorHarness {
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  private root: Root | null = null;
  private host: HTMLDivElement | null = null;
  private seenCalls = 0;
  readonly unhandled: string[] = [];
  private readonly onUnhandled = (reason: unknown) => {
    this.unhandled.push(String(reason));
  };

  constructor(recording: Pick<Recording, "rows">, scenario: Pick<Scenario, "detailId" | "characters" | "rows">) {
    const rows = scenario.rows === undefined || scenario.rows === "ALL" ? recording.rows : scenario.rows;
    fakeRegexStorage.reset(rows as Recording["rows"], scenario.characters);
    useUIStore.setState({ regexDetailId: scenario.detailId, editorDirty: false });
    process.on("unhandledRejection", this.onUnhandled);
  }

  async mount() {
    this.host = document.createElement("div");
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
    act(() => {
      this.root!.render(
        <QueryClientProvider client={this.queryClient}>
          <RegexScriptEditor />
        </QueryClientProvider>,
      );
    });
    await settle();
  }

  async unmount() {
    act(() => this.root?.unmount());
    this.host?.remove();
    this.queryClient.clear();
    // Let rejections from the last step surface before the listener goes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", this.onUnhandled);
  }

  get element(): HTMLElement {
    return this.host!;
  }

  buttons(): HTMLButtonElement[] {
    return [...this.host!.querySelectorAll("button")];
  }

  button(text: string, index = 0): HTMLButtonElement {
    const found = this.buttons().filter((button) => collapse(button.textContent ?? "") === text)[index];
    if (!found) throw new ControlNotFound(`No button "${text}" #${index}`);
    return found;
  }

  buttonWith(attribute: string, value: string): HTMLButtonElement {
    const found = this.buttons().find((button) => button.getAttribute(attribute) === value);
    if (!found) throw new ControlNotFound(`No button with ${attribute}="${value}"`);
    return found;
  }

  field(placeholder: string, index = 0): HTMLInputElement | HTMLTextAreaElement {
    const fields = [...this.host!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")];
    const matches =
      placeholder === "#order"
        ? fields.filter((field) => field.type === "number" && !field.hasAttribute("placeholder"))
        : fields.filter((field) => field.getAttribute("placeholder") === placeholder);
    const found = matches[index];
    if (!found) throw new ControlNotFound(`No field "${placeholder}" #${index}`);
    return found;
  }

  /** The buttons in the character list (the box right after Global). */
  characterRows(): HTMLButtonElement[] {
    const global = this.buttons().find((button) => collapse(button.textContent ?? "") === "Global");
    const list = global?.nextElementSibling;
    return list ? [...list.querySelectorAll("button")] : [];
  }

  async click(element: HTMLElement) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  async type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
  }

  /** Runs one recorded step. */
  async run(step: Step) {
    const [kind, ...args] = step;
    switch (kind) {
      case "mount":
        return this.mount();
      case "type":
        return this.type(this.field(args[0] as string), args[1] as string);
      case "typeAt":
        return this.type(this.field(args[0] as string, args[1] as number), args[2] as string);
      case "click":
        return this.click(this.button(args[0] as string));
      case "clickAt":
        return this.click(this.button(args[0] as string, args[1] as number));
      case "clickTitle":
        return this.click(this.buttonWith("title", args[0] as string));
      case "clickLabel":
        return this.click(this.buttonWith("aria-label", args[0] as string));
      case "removeTrim": {
        const trim = this.field("String to trim…", args[0] as number);
        const remove = trim.parentElement?.querySelector("button");
        if (!remove) throw new ControlNotFound(`No remove button for trim ${String(args[0])}`);
        return this.click(remove);
      }
      case "dismissError": {
        const dismiss = this.host!.querySelector<HTMLButtonElement>(".bg-red-500\\/10 button");
        if (!dismiss) throw new ControlNotFound("No save error banner");
        return this.click(dismiss);
      }
      case "confirm":
        fakeRegexStorage.answerConfirm(args[0] as boolean);
        return;
      case "fail":
        fakeRegexStorage.failNext(args[0] as "create" | "update" | "delete", args[1] as string);
        return;
      case "hold":
        fakeRegexStorage.hold();
        return;
      case "release":
        await act(async () => fakeRegexStorage.release());
        return settle();
      case "wait":
        await act(() => new Promise((resolve) => setTimeout(resolve, args[0] as number)));
        return settle();
      case "refetch":
        await act(() => this.queryClient.invalidateQueries({ queryKey: ["regex-scripts"] }));
        return settle();
      default:
        throw new Error(`Unknown step kind ${kind}`);
    }
  }

  /** Runs a step and returns what the recorder would have recorded after it. */
  async record(step: Step): Promise<StepResult> {
    try {
      await this.run(step);
    } catch (error) {
      if (error instanceof ControlNotFound) return { step, error: error.message };
      throw error;
    }
    return { step, ...this.snapshot() };
  }

  snapshot(): Snapshot {
    const host = this.host!;
    const characterRows = new Set(this.characterRows());
    const findInput = [...host.querySelectorAll("input")].find(
      (input) => input.getAttribute("placeholder") === FIND_PLACEHOLDER,
    );
    const patternError = findInput?.nextElementSibling?.tagName === "P" ? findInput.nextElementSibling : null;
    const textarea = host.querySelector("textarea");
    const resultCard = textarea?.nextElementSibling;
    const calls = fakeRegexStorage.calls.slice(this.seenCalls);
    this.seenCalls = fakeRegexStorage.calls.length;
    const { regexDetailId, editorDirty } = useUIStore.getState();
    return {
      text: collapse(host.textContent ?? ""),
      inputs: [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((field) => ({
        tag: field.tagName.toLowerCase(),
        type: field.type,
        placeholder: field.getAttribute("placeholder"),
        value: field.value,
        ...(field.classList.contains(ERROR_RING_CLASS) ? { invalid: true } : {}),
      })),
      buttons: this.buttons().map((button) => {
        const snapshot: ButtonSnapshot = { text: collapse(button.textContent ?? "") };
        for (const attribute of ["aria-label", "title", "aria-pressed"] as const) {
          const value = button.getAttribute(attribute);
          if (value !== null) snapshot[attribute] = value;
        }
        if (button.disabled) snapshot.disabled = true;
        if (button.getAttribute("aria-pressed") === "true") snapshot.selected = true;
        if (characterRows.has(button)) snapshot.checked = button.querySelector("svg.lucide-check") !== null;
        const toggle = button.querySelector("svg.lucide-toggle-right, svg.lucide-toggle-left");
        if (toggle) {
          snapshot.icon = toggle.classList.contains("lucide-toggle-right")
            ? "lucide-toggle-right"
            : "lucide-toggle-left";
        }
        return snapshot;
      }),
      result: resultCard ? (resultCard.lastElementChild?.textContent ?? null) : null,
      patternError: patternError?.textContent ?? null,
      store: { regexDetailId, editorDirty },
      calls: calls.map((call) => [...call]),
    };
  }
}

/** Lets queries, mutations and React Query's batched notifications finish. */
export async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Mounts a fresh editor for a recorded scenario and replays every step. */
export async function replayScenario(recording: Recording, scenario: Scenario) {
  const harness = new EditorHarness(recording, scenario);
  const results: StepResult[] = [];
  try {
    for (const recorded of scenario.steps) results.push(await harness.record(recorded.step));
  } finally {
    await harness.unmount();
  }
  return { results, unhandled: harness.unhandled };
}
