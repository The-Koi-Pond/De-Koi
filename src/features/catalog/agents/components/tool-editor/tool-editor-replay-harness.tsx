// Replays the black-box recordings (test-fixtures/README.md) against the editor: the real UI store, the
// real hooks in a fresh QueryClient without retries, and the fake storage and confirm dialog, which the
// spec files install with `vi.mock` (see `fake-tool-storage.ts`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { fakeToolStorage } from "./fake-tool-storage";
import { ToolEditor } from "./ToolEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Step = [string, ...unknown[]];

export interface FieldSnapshot {
  tag: string;
  type?: string;
  placeholder?: string | null;
  value: string;
  checked?: boolean;
  selectedIndex?: number;
  options?: string[];
  "aria-label"?: string;
}

export interface ButtonSnapshot {
  text: string;
  "aria-label"?: string;
  title?: string;
  "aria-pressed"?: string;
  disabled?: boolean;
}

export interface Snapshot {
  text: string;
  fields: FieldSnapshot[];
  buttons: ButtonSnapshot[];
  store: { toolDetailId: string | null; editorDirty: boolean };
  calls: unknown[][];
}

export type StepResult = { step: Step } & (Snapshot | { error: string });

export interface Scenario {
  id: string;
  detailId: string | null;
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

  constructor(recording: Pick<Recording, "rows">, scenario: Pick<Scenario, "detailId" | "rows">) {
    const rows = scenario.rows === undefined || scenario.rows === "ALL" ? recording.rows : scenario.rows;
    fakeToolStorage.reset(rows as Recording["rows"]);
    useUIStore.setState({ toolDetailId: scenario.detailId, editorDirty: false });
    process.on("unhandledRejection", this.onUnhandled);
  }

  async mount() {
    this.host = document.createElement("div");
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
    act(() => {
      this.root!.render(
        <QueryClientProvider client={this.queryClient}>
          <ToolEditor />
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

  buttonWith(attribute: string, value: string, index = 0): HTMLButtonElement {
    const found = this.buttons().filter((button) => button.getAttribute(attribute) === value)[index];
    if (!found) throw new ControlNotFound(`No button with ${attribute}="${value}" #${index}`);
    return found;
  }

  field(placeholder: string, index = 0): HTMLInputElement | HTMLTextAreaElement {
    const fields = [...this.host!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")];
    const found = fields.filter((field) => field.getAttribute("placeholder") === placeholder)[index];
    if (!found) throw new ControlNotFound(`No field "${placeholder}" #${index}`);
    return found;
  }

  /** The type dropdown of parameter row `index`. */
  typeSelect(index: number): HTMLSelectElement {
    const found = [...this.host!.querySelectorAll("select")][index];
    if (!found) throw new ControlNotFound(`No type dropdown #${index}`);
    return found;
  }

  /** The Required checkbox of parameter row `index`. */
  requiredBox(index: number): HTMLInputElement {
    const found = [...this.host!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][index];
    if (!found) throw new ControlNotFound(`No Required checkbox #${index}`);
    return found;
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

  async choose(select: HTMLSelectElement, value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
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
      case "select":
        return this.choose(this.typeSelect(args[0] as number), args[1] as string);
      case "check":
        return this.click(this.requiredBox(args[0] as number));
      case "click":
        return this.click(this.button(args[0] as string));
      case "clickAt":
        return this.click(this.button(args[0] as string, args[1] as number));
      case "clickLabel":
        return this.click(this.buttonWith("aria-label", args[0] as string));
      case "removeParam":
        return this.click(this.buttonWith("aria-label", "Remove parameter", args[0] as number));
      case "dismissError": {
        const dismiss = this.host!.querySelector<HTMLButtonElement>(".bg-red-500\\/10 button");
        if (!dismiss) throw new ControlNotFound("No save error banner");
        return this.click(dismiss);
      }
      case "confirm":
        fakeToolStorage.answerConfirm(args[0] as boolean);
        return;
      case "fail":
        fakeToolStorage.failNext(args[0] as "create" | "update" | "delete", args[1] as string);
        return;
      case "hold":
        fakeToolStorage.hold();
        return;
      case "release":
        await act(async () => fakeToolStorage.release());
        return settle();
      case "createNoId":
        fakeToolStorage.createNoId();
        return;
      case "patchRow":
        fakeToolStorage.patchRow(args[0] as string, args[1] as Record<string, unknown>);
        return;
      case "wait":
        await act(() => new Promise((resolve) => setTimeout(resolve, args[0] as number)));
        return settle();
      case "refetch":
        await act(() => this.queryClient.invalidateQueries({ queryKey: ["custom-tools"] }));
        return settle();
      case "open":
        act(() => useUIStore.getState().openToolDetail(args[0] as string));
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
    const calls = fakeToolStorage.calls.slice(this.seenCalls);
    this.seenCalls = fakeToolStorage.calls.length;
    const { toolDetailId, editorDirty } = useUIStore.getState();
    return {
      text: collapse(host.textContent ?? ""),
      fields: [
        ...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"),
      ].map((field) => {
        const label = field.getAttribute("aria-label");
        const named = label === null ? {} : { "aria-label": label };
        if (field instanceof HTMLSelectElement) {
          return {
            tag: "select",
            value: field.value,
            selectedIndex: field.selectedIndex,
            options: [...field.options].map((option) => option.value),
            ...named,
          };
        }
        return {
          tag: field.tagName.toLowerCase(),
          type: field.type,
          placeholder: field.getAttribute("placeholder"),
          value: field.value,
          ...(field instanceof HTMLInputElement && field.type === "checkbox" ? { checked: field.checked } : {}),
          ...named,
        };
      }),
      buttons: this.buttons().map((button) => {
        const snapshot: ButtonSnapshot = { text: collapse(button.textContent ?? "") };
        for (const attribute of ["aria-label", "title", "aria-pressed"] as const) {
          const value = button.getAttribute(attribute);
          if (value !== null) snapshot[attribute] = value;
        }
        if (button.disabled) snapshot.disabled = true;
        return snapshot;
      }),
      store: { toolDetailId, editorDirty },
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
