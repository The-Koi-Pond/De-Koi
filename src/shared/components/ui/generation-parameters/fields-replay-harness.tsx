// Replays the fields recordings (test-fixtures/README.md, "Fields recordings") against the new fields: the
// recorder's caller, its step kinds and its compact and full snapshots, read from this markup. Fields are found
// by their accessible names (decision 2) and option selection is read from `aria-pressed` (decision 1).
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GenerationParametersFields, type EditableGenerationParameters, type GenerationServiceTier } from "./index";
import { decode, encode } from "./recorded-encoding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Group = "tier" | "reasoning" | "verbosity";

type FieldAction =
  | { do: "focus" | "blur"; field: string }
  | { do: "fill" | "keys"; field: string; text: string }
  | { do: "key"; field: string; key: string; ctrl?: boolean; meta?: boolean }
  | { do: "click"; group: Group; option: string }
  | { do: "click"; button: "add-tag" }
  | { do: "click"; button: "remove-tag"; n: number };

export type FieldsAction = FieldAction | { do: "rerender"; patch: Record<string, unknown> };

export interface CompactSnapshot {
  values: Record<string, string>;
  tags: Array<[string, string]>;
  selected: Record<Group, string[] | null>;
  tierOptions: string[] | null;
  addDisabled: boolean;
  cpPlaceholder: string;
  cpNote: string;
}

export interface Control {
  tag: string;
  type?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  inputMode?: string;
  rows?: string;
  spellCheck?: string;
  text?: string;
  selected?: boolean;
  disabled?: true;
}

export interface FullSnapshot extends CompactSnapshot {
  texts: string[];
  controls: Control[];
}

export interface FieldsStep {
  action: FieldsAction;
  calls: unknown[];
  shown: CompactSnapshot;
}

export interface FieldsScenario {
  id: string;
  value: string;
  tiers: string;
  handsBack: boolean;
  start: CompactSnapshot | FullSnapshot;
  steps: FieldsStep[];
}

export interface FieldsRecording {
  values: Record<string, unknown>;
  tiers: Record<string, unknown>;
  scenarios: FieldsScenario[];
}

export const NUMBER_FIELD_NAMES: Record<string, string> = {
  temperature: "Temperature",
  maxTokens: "Max Output Tokens",
  topP: "Top P",
  topK: "Top K",
  frequencyPenalty: "Frequency",
  presencePenalty: "Presence",
};

/** The recordings' field keys → this markup's accessible names (decision 2). */
function fieldName(key: string): string {
  if (key in NUMBER_FIELD_NAMES) return NUMBER_FIELD_NAMES[key]!;
  if (key === "prefill") return "Assistant Prefill";
  if (key === "customParameters") return "Custom Parameters";
  const tag = /^tag:(\d+):(open|close)$/.exec(key);
  if (tag) return `Custom thinking tag ${tag[1]} ${tag[2]}`;
  throw new Error(`Unknown field ${key}`);
}

const VALUE_KEYS = [...Object.keys(NUMBER_FIELD_NAMES), "prefill", "customParameters"];
const GROUPS: Group[] = ["tier", "reasoning", "verbosity"];

export const trimmedText = (element: Element) => (element.textContent ?? "").trim();

/** Reads and drives the fields inside `host`, by accessible names, `aria-pressed` and the option rows. */
export class FieldsView {
  constructor(private readonly host: HTMLElement) {}

  findByName<T extends HTMLElement>(name: string): T | null {
    return (
      [...this.host.querySelectorAll<T>("[aria-label]")].find(
        (element) => element.getAttribute("aria-label") === name,
      ) ?? null
    );
  }

  byName<T extends HTMLElement>(name: string): T {
    const found = this.findByName<T>(name);
    if (!found) throw new Error(`No element named "${name}"`);
    return found;
  }

  field(key: string): HTMLInputElement | HTMLTextAreaElement {
    return this.byName<HTMLInputElement | HTMLTextAreaElement>(fieldName(key));
  }

  /** Whether the fields are rendered at all. */
  present(): boolean {
    return this.findByName(fieldName("temperature")) !== null;
  }

  addTagButton(): HTMLButtonElement {
    const found = [...this.host.querySelectorAll("button")].find((button) => trimmedText(button) === "Add tag");
    if (!found) throw new Error("No Add tag button");
    return found;
  }

  optionButtons(group: Group): HTMLButtonElement[] | null {
    const row = this.host.querySelector(`[data-option-group="${group}"]`);
    return row ? [...row.querySelectorAll("button")] : null;
  }

  optionButton(group: Group, option: string): HTMLButtonElement {
    const found = this.optionButtons(group)?.find((button) => trimmedText(button) === option);
    if (!found) throw new Error(`No ${group} option "${option}"`);
    return found;
  }

  snapshot(): CompactSnapshot {
    const values = Object.fromEntries(VALUE_KEYS.map((key) => [key, this.field(key).value]));
    const tags: Array<[string, string]> = [];
    for (let n = 1; this.findByName(fieldName(`tag:${n}:open`)); n++) {
      tags.push([this.field(`tag:${n}:open`).value, this.field(`tag:${n}:close`).value]);
    }
    const selected = Object.fromEntries(
      GROUPS.map((group) => [
        group,
        this.optionButtons(group)
          ?.filter((button) => button.getAttribute("aria-pressed") === "true")
          .map(trimmedText) ?? null,
      ]),
    ) as Record<Group, string[] | null>;
    const customParameters = this.field("customParameters");
    return {
      values,
      tags,
      selected,
      tierOptions: this.optionButtons("tier")?.map(trimmedText) ?? null,
      addDisabled: this.addTagButton().disabled,
      cpPlaceholder: customParameters.placeholder,
      cpNote: trimmedText(customParameters.nextElementSibling!),
    };
  }

  fullSnapshot(): FullSnapshot {
    return { ...this.snapshot(), texts: textsOf(this.host), controls: this.controls() };
  }

  /**
   * Every input, textarea and button, as the recorder listed them. The recorder read `selected` from the look of
   * every button with visible text (the option buttons and "Add tag"); this reads it from `aria-pressed`.
   */
  private controls(): Control[] {
    return [...this.host.querySelectorAll<HTMLElement>("input, textarea, button")].map((element) => {
      const control: Control = { tag: element.tagName.toLowerCase() };
      const attribute = (name: string) => element.getAttribute(name) ?? undefined;
      if (attribute("type") !== undefined) control.type = attribute("type");
      if (attribute("aria-label") !== undefined) control.name = attribute("aria-label");
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) control.value = element.value;
      if (attribute("placeholder") !== undefined) control.placeholder = attribute("placeholder");
      if (attribute("inputmode") !== undefined) control.inputMode = attribute("inputmode");
      if (attribute("rows") !== undefined) control.rows = attribute("rows");
      if (attribute("spellcheck") !== undefined) control.spellCheck = attribute("spellcheck");
      if (element instanceof HTMLButtonElement) {
        control.text = trimmedText(element);
        if (control.text) control.selected = element.getAttribute("aria-pressed") === "true";
      }
      if ((element as HTMLButtonElement).disabled) control.disabled = true;
      return control;
    });
  }
}

/** Runs one of the README's field step kinds (all but `rerender`) on the fields in `view`. */
export function runFieldAction(view: FieldsView, action: FieldAction) {
  switch (action.do) {
    case "focus":
      act(() => view.field(action.field).focus());
      break;
    case "blur":
      act(() => view.field(action.field).blur());
      break;
    case "fill": {
      const field = view.field(action.field);
      act(() => setNativeValue(field, action.text));
      break;
    }
    case "keys": {
      const field = view.field(action.field);
      for (const character of action.text) act(() => setNativeValue(field, field.value + character));
      break;
    }
    case "key": {
      const field = view.field(action.field);
      const event = new KeyboardEvent("keydown", {
        key: action.key,
        ctrlKey: action.ctrl ?? false,
        metaKey: action.meta ?? false,
        bubbles: true,
        cancelable: true,
      });
      act(() => field.dispatchEvent(event));
      break;
    }
    case "click": {
      const target =
        "group" in action
          ? view.optionButton(action.group, action.option)
          : action.button === "add-tag"
            ? view.addTagButton()
            : view.byName<HTMLButtonElement>(`Remove custom thinking tag ${action.n}`);
      act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      break;
    }
  }
}

export function setNativeValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Every non-blank text in DOM order, trimmed, with text nodes that are siblings in a row joined. */
export function textsOf(host: HTMLElement): string[] {
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

interface CallerProps {
  initial: EditableGenerationParameters;
  serviceTierOptions: readonly GenerationServiceTier[] | undefined;
  handsBack: boolean;
  onCall: (next: EditableGenerationParameters) => void;
  exposeSetter: (set: (patch: Record<string, unknown>) => void, value: EditableGenerationParameters) => void;
}

/** The recorder's caller: holds the value in state and takes handed-over values back only when `handsBack`. */
function Caller({ initial, serviceTierOptions, handsBack, onCall, exposeSetter }: CallerProps) {
  const [value, setValue] = useState(initial);
  exposeSetter((patch) => setValue((state) => ({ ...state, ...patch })), value);
  return (
    <GenerationParametersFields
      value={value}
      serviceTierOptions={serviceTierOptions}
      onChange={(next) => {
        onCall(next);
        if (handsBack) setValue(next);
      }}
    />
  );
}

export class FieldsHarness {
  private readonly host = document.createElement("div");
  private readonly root: Root;
  private calls: unknown[] = [];
  private patchValue: (patch: Record<string, unknown>) => void = () => {};
  private shownValue: EditableGenerationParameters | null = null;
  readonly view = new FieldsView(this.host);

  constructor(
    initial: EditableGenerationParameters,
    serviceTierOptions: readonly GenerationServiceTier[] | undefined,
    handsBack: boolean,
  ) {
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
    act(() => {
      this.root.render(
        <Caller
          initial={initial}
          serviceTierOptions={serviceTierOptions}
          handsBack={handsBack}
          onCall={(next) => this.calls.push(encode(next))}
          exposeSetter={(set, value) => {
            this.patchValue = set;
            this.shownValue = value;
          }}
        />,
      );
    });
  }

  get element(): HTMLElement {
    return this.host;
  }

  /** The value the caller holds now (what it would save). */
  get value(): EditableGenerationParameters {
    return this.shownValue!;
  }

  unmount() {
    act(() => this.root.unmount());
    this.host.remove();
  }

  /** Runs one recorded action and returns the (encoded) values handed over during it. */
  run(action: FieldsAction): unknown[] {
    this.calls = [];
    if (action.do === "rerender") {
      const patch = decode(action.patch) as Record<string, unknown>;
      act(() => this.patchValue(patch));
    } else {
      runFieldAction(this.view, action);
    }
    return this.calls;
  }
}

export interface FieldsReplay {
  start: CompactSnapshot | FullSnapshot;
  steps: Array<{ calls: unknown[]; shown: CompactSnapshot }>;
}

/** Mounts the scenario's caller, takes the start snapshot (full when the recording has one) and runs every step. */
export function replayFieldsScenario(recording: FieldsRecording, scenario: FieldsScenario): FieldsReplay {
  const harness = new FieldsHarness(
    decode(recording.values[scenario.value]) as EditableGenerationParameters,
    decode(recording.tiers[scenario.tiers]) as readonly GenerationServiceTier[] | undefined,
    scenario.handsBack,
  );
  try {
    const start = "controls" in scenario.start ? harness.view.fullSnapshot() : harness.view.snapshot();
    const steps = scenario.steps.map((step) => {
      const calls = [...harness.run(step.action)];
      return { calls, shown: harness.view.snapshot() };
    });
    return { start, steps };
  } finally {
    harness.unmount();
  }
}
