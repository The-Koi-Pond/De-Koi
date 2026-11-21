// Replays the black-box recordings (test-fixtures/README.md) against the picker: the recorder's caller,
// its step kinds and its snapshot fields, read from this picker's markup.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ColorPicker } from "./Picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface RecordedProps {
  label: string;
  gradient?: boolean;
  compact?: boolean;
  helpText?: string;
  emptyText?: string;
  headerAction?: "switch";
  disabled?: boolean;
}

export type Action =
  | { do: "toggle" }
  | { do: "click"; text: string }
  | { do: "click"; name: string }
  | { do: "set"; name: string; value: string }
  | { do: "type"; name: string; text: string }
  | { do: "value"; value: string }
  | { do: "rerender"; disabled: boolean };

type Flags = { disabled?: true };
type SwatchSnapshot = { checker: true } | { background: string } | { backgroundColor: string } | Record<string, never>;
type InputSnapshot = { value: string } & Flags;
type PresetsSnapshot = { count: number; selected: number[]; disabled?: true };

export interface Snapshot {
  texts: string[];
  trigger: {
    name: string | null;
    expanded: string | null;
    controlsPanel: boolean | null;
    disabled?: true;
    swatch: SwatchSnapshot;
  };
  clear: Flags | null;
  switch?: { solid: { selected?: true } & Flags; gradient: { selected?: true } & Flags } | null;
  mode?: "solid" | "gradient";
  solid?: {
    pickSwatch: SwatchSnapshot;
    native: InputSnapshot;
    field: InputSnapshot & { placeholder: string | null };
    presets: PresetsSnapshot;
  };
  gradient?: {
    preview: string;
    add: Flags;
    stops: Array<{ color: InputSnapshot; text: InputSnapshot; remove: Flags | null }>;
    angle: InputSnapshot & { min: string | null; max: string | null };
    presets: PresetsSnapshot;
  };
}

export interface RecordedStep {
  action: Action;
  calls: string[];
  shown: Snapshot;
}

export interface Scenario {
  id: string;
  props: string;
  value: string;
  handsBack: boolean;
  start?: Snapshot;
  steps: RecordedStep[];
}

export interface Recording {
  format: number;
  props: Record<string, RecordedProps>;
  values: Record<string, string>;
  names?: { solid: Array<[string, string]>; gradient: string[] };
  scenarios: Scenario[];
}

export interface ReplayResult {
  start: Snapshot;
  steps: Array<{ calls: string[]; shown: Snapshot }>;
}

class ControlNotFound extends Error {}

const trimmedText = (element: Element) => (element.textContent ?? "").trim();
const flags = (element: HTMLButtonElement | HTMLInputElement): Flags => (element.disabled ? { disabled: true } : {});

interface CallerProps {
  props: RecordedProps;
  initial: string;
  handsBack: boolean;
  onCall: (value: string) => void;
  exposeSetter: (set: (value: string) => void) => void;
}

/** The recorder's caller: holds `value` in state and hands values back only when `handsBack` is set. */
function Caller({ props, initial, handsBack, onCall, exposeSetter }: CallerProps) {
  const [value, setValue] = useState(initial);
  exposeSetter(setValue);
  const { headerAction, ...pickerProps } = props;
  return (
    <ColorPicker
      {...pickerProps}
      value={value}
      headerAction={
        headerAction === "switch" ? (
          <input type="checkbox" aria-label={`${props.label} channel`} defaultChecked />
        ) : undefined
      }
      onChange={(next) => {
        onCall(next);
        if (handsBack) setValue(next);
      }}
    />
  );
}

export class PickerHarness {
  private readonly host = document.createElement("div");
  private readonly root: Root;
  private calls: string[] = [];
  private setValue: (value: string) => void = () => {};
  private props: RecordedProps;
  readonly label: string;

  constructor(
    props: RecordedProps,
    private readonly initial: string,
    private readonly handsBack: boolean,
  ) {
    this.props = props;
    this.label = props.label;
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
    this.render();
  }

  private render() {
    act(() => {
      this.root.render(
        <Caller
          props={this.props}
          initial={this.initial}
          handsBack={this.handsBack}
          onCall={(value) => this.calls.push(value)}
          exposeSetter={(set) => {
            this.setValue = set;
          }}
        />,
      );
    });
  }

  unmount() {
    act(() => this.root.unmount());
    this.host.remove();
  }

  get element(): HTMLElement {
    return this.host;
  }

  /** Runs one recorded action and returns the values handed over during it. */
  run(action: Action): string[] {
    this.calls = [];
    switch (action.do) {
      case "toggle":
        this.click(this.trigger());
        break;
      case "click":
        this.click("text" in action ? this.buttonByText(action.text) : this.byName(action.name));
        break;
      case "set": {
        const input = this.byName(action.name) as HTMLInputElement;
        act(() => setNativeValue(input, action.value));
        break;
      }
      case "type": {
        const input = this.byName(action.name) as HTMLInputElement;
        for (const character of action.text) act(() => setNativeValue(input, input.value + character));
        break;
      }
      case "value":
        act(() => this.setValue(action.value));
        break;
      case "rerender":
        this.props = { ...this.props, disabled: action.disabled };
        this.render();
        break;
    }
    return this.calls;
  }

  private click(element: Element) {
    act(() => (element as HTMLElement).click());
  }

  trigger(): HTMLButtonElement {
    const found = this.host.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (!found) throw new ControlNotFound("No swatch button");
    return found;
  }

  buttonByText(text: string): HTMLButtonElement {
    const found = this.findButtonByText(text);
    if (!found) throw new ControlNotFound(`No button "${text}"`);
    return found;
  }

  findButtonByText(text: string): HTMLButtonElement | null {
    return [...this.host.querySelectorAll("button")].find((button) => trimmedText(button) === text) ?? null;
  }

  byName(name: string): HTMLElement {
    const found = this.findByName(name);
    if (!found) throw new ControlNotFound(`No element named "${name}"`);
    return found;
  }

  findByName(name: string): HTMLElement | null {
    return (
      [...this.host.querySelectorAll<HTMLElement>("[aria-label]")].find(
        (element) => element.getAttribute("aria-label") === name,
      ) ?? null
    );
  }

  snapshot(): Snapshot {
    const trigger = this.trigger();
    const clear = this.findButtonByText("Clear");
    const snapshot: Snapshot = {
      texts: textsOf(this.host),
      trigger: {
        name: trigger.getAttribute("aria-label"),
        expanded: trigger.getAttribute("aria-expanded"),
        controlsPanel: trigger.hasAttribute("aria-controls")
          ? document.getElementById(trigger.getAttribute("aria-controls")!) !== null
          : null,
        ...flags(trigger),
        swatch: swatchOf(trigger.querySelector("[data-swatch]")),
      },
      clear: clear ? flags(clear) : null,
    };
    if (trigger.getAttribute("aria-expanded") !== "true") return snapshot;

    const solidButton = this.findButtonByText("Solid");
    const gradientButton = this.findButtonByText("Gradient");
    snapshot.switch =
      solidButton && gradientButton
        ? { solid: switchButton(solidButton), gradient: switchButton(gradientButton) }
        : null;

    const native = this.findByName(`Pick ${this.label} color`) as HTMLInputElement | null;
    if (native) {
      const field = this.byName(`${this.label} hex or CSS color`) as HTMLInputElement;
      snapshot.mode = "solid";
      snapshot.solid = {
        pickSwatch: swatchOf(native.parentElement!.querySelector("[data-swatch]")),
        native: input(native),
        field: { ...input(field), placeholder: field.getAttribute("placeholder") },
        presets: this.presets(/^Use #/),
      };
      return snapshot;
    }

    const stops: NonNullable<Snapshot["gradient"]>["stops"] = [];
    for (let n = 1; ; n++) {
      const color = this.findByName(`${this.label} gradient stop ${n} color`) as HTMLInputElement | null;
      if (!color) break;
      const remove = this.findByName(`Remove ${this.label} gradient stop ${n}`) as HTMLButtonElement | null;
      stops.push({
        color: input(color),
        text: input(this.byName(`${this.label} gradient stop ${n} CSS color`) as HTMLInputElement),
        remove: remove ? flags(remove) : null,
      });
    }
    const angle = this.byName("Gradient angle") as HTMLInputElement;
    snapshot.mode = "gradient";
    snapshot.gradient = {
      preview: this.host.querySelector<HTMLElement>("[data-gradient-preview]")!.style.background,
      add: flags(this.buttonByText("Add")),
      stops,
      angle: { ...input(angle), min: angle.getAttribute("min"), max: angle.getAttribute("max") },
      presets: this.presets(/^Use gradient preset /),
    };
    return snapshot;
  }

  /** The preset swatches, with selection read from `aria-pressed` (decision 1). */
  presets(pattern: RegExp): PresetsSnapshot {
    const buttons = [...this.host.querySelectorAll<HTMLButtonElement>("button[aria-label]")].filter((button) =>
      pattern.test(button.getAttribute("aria-label")!),
    );
    const selected = buttons.flatMap((button, index) =>
      button.getAttribute("aria-pressed") === "true" ? [index] : [],
    );
    const allDisabled = buttons.length > 0 && buttons.every((button) => button.disabled);
    return { count: buttons.length, selected, ...(allDisabled ? { disabled: true as const } : {}) };
  }
}

function setNativeValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function input(element: HTMLInputElement): InputSnapshot {
  return { value: element.value, ...flags(element) };
}

function switchButton(button: HTMLButtonElement) {
  return { ...(button.getAttribute("aria-pressed") === "true" ? { selected: true as const } : {}), ...flags(button) };
}

function swatchOf(element: Element | null): SwatchSnapshot {
  if (!(element instanceof HTMLElement)) throw new ControlNotFound("No swatch");
  if (element.dataset.swatch === "empty") return { checker: true };
  // A gradient the browser rejects leaves `background-image: none` behind the shorthand: no gradient set.
  const image = element.style.backgroundImage;
  if (image && image !== "none") return { background: image };
  if (element.style.backgroundColor) return { backgroundColor: element.style.backgroundColor };
  return {};
}

/** Every non-blank text in DOM order, trimmed, with text nodes that are siblings in a row joined. */
function textsOf(host: HTMLElement): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let run = "";
  let last: Node | null = null;
  const flush = () => {
    if (run.trim()) texts.push(run.trim());
    run = "";
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (last && last.nextSibling !== node) flush();
    run += node.nodeValue ?? "";
    last = node;
  }
  flush();
  return texts;
}

/** Mounts the scenario's caller, takes the start snapshot and runs every step. */
export function replayScenario(recording: Recording, scenario: Scenario): ReplayResult {
  const harness = new PickerHarness(
    recording.props[scenario.props]!,
    recording.values[scenario.value]!,
    scenario.handsBack,
  );
  try {
    // The disable-while-open scenarios open the panel before their first step, without recording it.
    if (scenario.id.startsWith("disable-while-open")) harness.run({ do: "toggle" });
    const start = harness.snapshot();
    const steps = scenario.steps.map((step) => {
      const calls = [...harness.run(step.action)];
      return { calls, shown: harness.snapshot() };
    });
    return { start, steps };
  } finally {
    harness.unmount();
  }
}
