// Replays the black-box recordings (test-fixtures/README.md) against the panel: the real gallery hooks in a
// fresh QueryClient without retries, and the recorder's stand-ins from `fake-gallery-storage.ts`, which the
// spec files install with `vi.mock`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll } from "vitest";
import { fakeGallery, type FailOp, type HoldOp } from "./fake-gallery-storage";
import { GlobalGalleryPanel } from "./GlobalGalleryPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The recordings were made in en-US with TZ=UTC; dates read the same here whatever the machine's settings.
const nativeToLocaleDateString = Date.prototype.toLocaleDateString;
beforeAll(() => {
  Date.prototype.toLocaleDateString = function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return nativeToLocaleDateString.call(this, locales ?? "en-US", { timeZone: "UTC", ...options });
  };
});
afterAll(() => {
  Date.prototype.toLocaleDateString = nativeToLocaleDateString;
});

export type Step = [string, ...unknown[]];

export interface ButtonSnapshot {
  text: string;
  "aria-label"?: string;
  title?: string;
  "aria-pressed"?: string;
  "aria-disabled"?: string;
  "data-kind"?: string;
  disabled?: boolean;
  ringed?: boolean;
}

export interface Snapshot {
  text: string;
  selects: Array<{ "aria-label"?: string; value: string; options: string[][]; disabled?: boolean }>;
  buttons: ButtonSnapshot[];
  links: Array<Record<string, string>>;
  images: Array<Record<string, string>>;
  cards: Array<{ title: string | null; faded: boolean }>;
  shimmer: number;
  dialog: { "aria-label": string | null; "aria-modal": string | null } | null;
  focus: string | null;
  calls: unknown[][];
}

export type StepResult = { step: Step } & (Snapshot | { error: string });

type Row = Record<string, unknown> & { id: string };
type FolderRow = Row & { name: string; createdAt: string };

export interface Scenario {
  id: string;
  images: string | Row[];
  folders: string | FolderRow[];
  before: Step[];
  steps: StepResult[];
  unhandled: string[];
}

export interface Recording {
  format: number;
  images: Row[];
  many: Row[];
  folders: FolderRow[];
  scenarios: Scenario[];
}

class ControlNotFound extends Error {}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function namedList<T>(recording: Recording, value: string | T[]): T[] {
  if (typeof value !== "string") return value;
  const named = { IMAGES: recording.images, MANY: recording.many, FOLDERS: recording.folders }[value];
  if (!named) throw new Error(`Unknown list ${value}`);
  return named as T[];
}

/** A `dataTransfer` stand-in shared from the last drag start, as the recorder's was. */
export function makeDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return [...data.keys()];
    },
    dropEffect: "none",
    effectAllowed: "all",
  };
}

export class GalleryHarness {
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  private root: Root | null = null;
  private host: HTMLDivElement | null = null;
  readonly outside: HTMLButtonElement;
  private dataTransfer = makeDataTransfer();
  private seenCalls = 0;
  readonly unhandled: string[] = [];
  private readonly onUnhandled = (reason: unknown) => {
    this.unhandled.push(String(reason));
  };

  constructor(recording: Recording, scenario: Pick<Scenario, "images" | "folders">) {
    fakeGallery.reset(namedList(recording, scenario.images), namedList(recording, scenario.folders));
    this.outside = document.createElement("button");
    this.outside.textContent = "outside";
    document.body.appendChild(this.outside);
    this.outside.focus();
    process.on("unhandledRejection", this.onUnhandled);
  }

  /** Renders `children` (default: the panel) the way the recorder mounted it. */
  async mount(children = <GlobalGalleryPanel />) {
    this.host = document.createElement("div");
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
    act(() => {
      this.root!.render(<QueryClientProvider client={this.queryClient}>{children}</QueryClientProvider>);
    });
    await settle();
  }

  async unmount() {
    act(() => this.root?.unmount());
    this.host?.remove();
    this.outside.remove();
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

  buttonNamed(name: string, index = 0): HTMLButtonElement {
    const found = this.buttons().filter(
      (button) => button.getAttribute("aria-label") === name || button.getAttribute("title") === name,
    )[index];
    if (!found) throw new ControlNotFound(`No button named "${name}" #${index}`);
    return found;
  }

  /** A folder chip by its label (the chip's first text, before its count). */
  chip(label: string): HTMLButtonElement {
    const found = [...this.host!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(
      (button) => button.querySelector("span")?.textContent === label,
    );
    if (!found) throw new ControlNotFound(`No chip "${label}"`);
    return found;
  }

  card(imageId: string): HTMLElement {
    const card = this.host!.querySelector(`[aria-label="Tag ${imageId}"]`)?.closest<HTMLElement>('[draggable="true"]');
    if (!card) throw new ControlNotFound(`No card ${imageId}`);
    return card;
  }

  select(name: string): HTMLSelectElement {
    const found = this.host!.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`);
    if (!found) throw new ControlNotFound(`No select "${name}"`);
    return found;
  }

  dialog(): HTMLElement {
    const found = this.host!.querySelector<HTMLElement>('[role="dialog"]');
    if (!found) throw new ControlNotFound("No dialog");
    return found;
  }

  async click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
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

  async key(key: string, shift = false) {
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true }));
    });
    await settle();
  }

  async upload(files: Array<[string, string]>) {
    const input = this.host!.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new ControlNotFound("No upload input");
    const list = files.map(([name, type]) => new File(["x"], name, { type }));
    Object.defineProperty(input, "files", { configurable: true, value: list });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }

  /** A drag event carrying the `dataTransfer` shared from the last drag start, or the one given. */
  async drag(type: string, target: Element, dataTransfer?: ReturnType<typeof makeDataTransfer>) {
    if (type === "dragstart") this.dataTransfer = makeDataTransfer();
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer ?? this.dataTransfer });
    act(() => {
      target.dispatchEvent(event);
    });
    await settle();
  }

  async release(op: HoldOp) {
    await act(async () => fakeGallery.release(op));
    await settle();
  }

  /** Runs one recorded step. */
  async run(step: Step) {
    const [kind, ...args] = step;
    const text = args[0] as string;
    switch (kind) {
      case "mount":
        return this.mount();
      case "chip":
        return this.click(this.chip(text));
      case "sort":
        return this.choose(this.select("Sort images"), text);
      case "click":
        return this.click(this.button(text, args[1] as number | undefined));
      case "clickLabel":
        return this.click(this.buttonNamed(text, args[1] as number | undefined));
      case "cardDelete":
        return this.click(this.card(text).querySelector('button[title="Delete"]')!);
      case "cardOpen":
        return this.click(this.card(text).querySelector("button")!);
      case "tag":
        return this.click(this.buttonNamed(`Tag ${text}`));
      case "upload":
        return this.upload(args[0] as Array<[string, string]>);
      case "dragStart":
        return this.drag("dragstart", this.card(text));
      case "dragEnd":
        return this.drag("dragend", this.card(text));
      case "dragOver":
        return this.drag("dragover", this.chip(text));
      case "dragLeave":
        return this.drag("dragleave", this.chip(text));
      case "drop":
        return this.drag("drop", this.chip(text));
      case "moveTo":
        return this.choose(this.select("Move image to folder"), text);
      case "lb": {
        const button = this.dialog().querySelector(`button[title="${text}"]`);
        if (!button) throw new ControlNotFound(`No lightbox button "${text}"`);
        return this.click(button);
      }
      case "key":
        return this.key(text, args[1] === "shift");
      case "backdrop":
        return this.click(this.dialog());
      case "clickImage":
        return this.click(this.dialog().querySelector("img")!);
      case "focusFirst":
        act(() => this.dialog().querySelector<HTMLElement>("select, a, button")!.focus());
        return settle();
      case "answer":
        fakeGallery.answer(args[0]);
        return;
      case "fail":
        fakeGallery.fail(args[0] as FailOp, args[1] as string);
        return;
      case "failFile":
        fakeGallery.failFile(args[0] as string, args[1] as string);
        return;
      case "hold":
        fakeGallery.hold(args[0] as HoldOp);
        return;
      case "release":
        return this.release(args[0] as HoldOp);
      case "removeFolderElsewhere":
        fakeGallery.removeFolder(text);
        await act(() => this.queryClient.invalidateQueries());
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

  /** The calls since the last snapshot (or since the last call to this). */
  takeCalls(): unknown[][] {
    const calls = fakeGallery.calls.slice(this.seenCalls);
    this.seenCalls = fakeGallery.calls.length;
    return calls.map((call) => [...call]);
  }

  snapshot(): Snapshot {
    const host = this.host!;
    const attributes = (element: Element, names: readonly string[]) => {
      const found: Record<string, string> = {};
      for (const name of names) {
        const value = element.getAttribute(name);
        if (value !== null) found[name] = value;
      }
      return found;
    };
    const dialog = host.querySelector('[role="dialog"]');
    const active = document.activeElement;
    return {
      text: collapse(host.textContent ?? ""),
      selects: [...host.querySelectorAll("select")].map((select) => ({
        ...attributes(select, ["aria-label"]),
        value: select.value,
        options: [...select.options].map((option) => [option.value, collapse(option.textContent ?? "")]),
        ...(select.disabled ? { disabled: true } : {}),
      })),
      buttons: this.buttons().map((button) => ({
        text: collapse(button.textContent ?? ""),
        ...attributes(button, ["aria-label", "title", "aria-pressed", "aria-disabled", "data-kind"]),
        ...(button.disabled ? { disabled: true } : {}),
        ...(button.classList.contains("ring-2") ? { ringed: true } : {}),
      })),
      links: [...host.querySelectorAll("a")].map((link) =>
        attributes(link, ["href", "download", "title", "draggable"]),
      ),
      images: [...host.querySelectorAll("img")].map((image) =>
        attributes(image, ["alt", "src", "draggable", "loading"]),
      ),
      cards: [...host.querySelectorAll('[draggable="true"]')].map((card) => ({
        title: card.getAttribute("title"),
        faded: card.classList.contains("opacity-40"),
      })),
      shimmer: host.querySelectorAll(".shimmer").length,
      dialog: dialog && {
        "aria-label": dialog.getAttribute("aria-label"),
        "aria-modal": dialog.getAttribute("aria-modal"),
      },
      focus: describeFocus(active),
      calls: this.takeCalls(),
    };
  }
}

function describeFocus(element: Element | null): string | null {
  if (!element || element === document.body) return null;
  const name =
    element.getAttribute("aria-label") ?? element.getAttribute("title") ?? collapse(element.textContent ?? "");
  return `${element.tagName.toLowerCase()}:${name}`;
}

/** Lets queries, mutations, resolvers and React Query's batched notifications finish. */
async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Mounts a fresh panel for a recorded scenario and replays every step. */
export async function replayScenario(recording: Recording, scenario: Scenario) {
  const harness = new GalleryHarness(recording, scenario);
  const results: StepResult[] = [];
  try {
    for (const step of scenario.before) await harness.run(step);
    for (const recorded of scenario.steps) results.push(await harness.record(recorded.step));
  } finally {
    await harness.unmount();
  }
  return { results, unhandled: harness.unhandled };
}
