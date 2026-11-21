import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackerCardColorConfig } from "../../../../engine/contracts/types/persona";
import type { TrackerCardPaintColors } from "../../../lib/tracker-card-colors";
import { TrackerCardColorControls, type TrackerCardColorEntityLabel } from "./index";
import recordedJson from "./test-fixtures/recorded-controls.json";

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  gradient?: boolean;
  compact?: boolean;
  label: string;
  helpText?: string;
  emptyText?: string;
  disabled?: boolean;
  headerAction?: ReactNode;
}

// The recordings replaced the ColorPicker with a stub that keeps its props and shows only its header action.
const pickers = vi.hoisted(() => new Map<string, PickerProps>());
vi.mock("../color-picker", () => ({
  ColorPicker: (props: PickerProps) => {
    pickers.set(props.label, props);
    return <div data-color-picker={props.label}>{props.headerAction}</div>;
  },
}));

interface RecordedProps {
  value?: TrackerCardColorConfig | string | null;
  chatColors: TrackerCardPaintColors;
  entityLabel: TrackerCardColorEntityLabel;
  variant?: "full" | "compact";
  disabled?: boolean;
}

type RecordedAction =
  | { kind: "click" | "toggle"; target: string; onChange?: number[]; skipped?: string }
  | { kind: "range"; target: string; value: number; onChange?: number[]; skipped?: string }
  | { kind: "color"; target: string; value: string; onChange?: number[]; skipped?: string };

interface RecordedState {
  id: string;
  props: RecordedProps;
  initial: ReturnType<typeof snapshot>;
  actions: RecordedAction[];
  collapse: { onChange: number[]; collapsed: ReturnType<typeof collapsedSnapshot>; reexpandedEqualsInitial: boolean };
}

const recorded = recordedJson as unknown as { configs: TrackerCardColorConfig[]; states: RecordedState[] };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const onChange = vi.fn<(value: TrackerCardColorConfig) => void>();

function mount(props: RecordedProps) {
  act(() => root?.unmount());
  host?.remove();
  pickers.clear();
  onChange.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<TrackerCardColorControls {...props} value={props.value} onChange={onChange} />);
  });
}

function panel(): HTMLElement {
  return host!.firstElementChild as HTMLElement;
}

function header(): HTMLButtonElement {
  return panel().querySelector<HTMLButtonElement>(":scope > button")!;
}

function bodyButtons(): HTMLButtonElement[] {
  const body = header().nextElementSibling;
  return body ? [...body.querySelectorAll<HTMLButtonElement>("button")] : [];
}

function sliders(): HTMLInputElement[] {
  return [...panel().querySelectorAll<HTMLInputElement>('input[type="range"]')];
}

function toggles(): HTMLInputElement[] {
  return [...panel().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

function rows(): HTMLElement[] {
  return [...panel().querySelectorAll<HTMLElement>("[data-channel-row]")];
}

function headerSnapshot() {
  const button = header();
  return {
    title: button.getAttribute("title"),
    ariaExpanded: button.getAttribute("aria-expanded"),
    heading: button.querySelector("[data-heading]")!.textContent,
    summary: button.querySelector("[data-summary]")!.textContent,
    // Like the recorder, only swatches that ended up with an inline style count (a whitespace-only
    // color is an invalid background-color, so that swatch has none).
    swatches: [...button.querySelectorAll<HTMLElement>("[data-swatch]")]
      .filter((swatch) => swatch.hasAttribute("style"))
      .map((swatch) => ({
        background: swatch.style.background || null,
        backgroundColor: swatch.style.backgroundColor || null,
        backgroundImage: swatch.style.backgroundImage || null,
        dimmed: swatch.classList.contains("opacity-35"),
      })),
    chevronCollapsed: button.querySelector("svg.lucide-chevron-right") !== null,
  };
}

function groups() {
  return [...panel().querySelectorAll("[data-group-heading]")].map((heading) => heading.textContent);
}

function snapshot() {
  return {
    rootDimmed: panel().classList.contains("opacity-75"),
    header: headerSnapshot(),
    groups: groups(),
    options: bodyButtons().map((button) => ({
      text: button.textContent,
      title: button.getAttribute("title"),
      disabled: button.disabled,
      selected: button.classList.contains("bg-[var(--primary)]/12"),
      check: button.querySelector("svg.lucide-check") !== null,
      ariaPressed: button.getAttribute("aria-pressed"),
    })),
    sliders: sliders().map((slider) => ({
      ariaLabel: slider.getAttribute("aria-label"),
      title: slider.getAttribute("title"),
      value: slider.value,
      disabled: slider.disabled,
      min: slider.getAttribute("min"),
      max: slider.getAttribute("max"),
    })),
    toggles: toggles().map((toggle) => ({
      ariaLabel: toggle.getAttribute("aria-label"),
      checked: toggle.checked,
      disabled: toggle.disabled,
      title: toggle.closest("label")!.getAttribute("title"),
    })),
    rowTitles: rows()
      .filter((row) => row.hasAttribute("title"))
      .map((row) => row.getAttribute("title")),
    pointerNoneRows: rows().filter((row) => row.classList.contains("pointer-events-none")).length,
    fainterRows: rows().filter((row) => row.classList.contains("bg-[var(--background)]/15")).length,
    colorPickers: [...panel().querySelectorAll<HTMLElement>("[data-color-picker]")].map((element) => {
      const { value, gradient, compact, disabled, label, emptyText, helpText } = pickers.get(
        element.dataset.colorPicker!,
      )!;
      return { value, gradient, compact, disabled, label, emptyText, helpText };
    }),
    text: panel().textContent!.replace(/\s+/g, " ").trim(),
  };
}

function collapsedSnapshot() {
  return {
    header: headerSnapshot(),
    groups: groups(),
    optionCount: bodyButtons().length,
    sliderCount: sliders().length,
  };
}

/** Decision 1: Source, Stage and Finish buttons announce their selection; the old build had no aria-pressed. */
function withDecisionOne(initial: RecordedState["initial"]) {
  return {
    ...initial,
    options: initial.options.map((option) => ({ ...option, ariaPressed: String(option.selected) })),
  };
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function setRange(slider: HTMLInputElement, value: number) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The control a recorded action works, and whether a user could use it. */
function controlFor(action: RecordedAction) {
  switch (action.kind) {
    case "click": {
      const button = bodyButtons().find((candidate) => candidate.textContent === action.target)!;
      return { found: button, disabled: button?.disabled, perform: () => click(button) };
    }
    case "range": {
      const slider = sliders().find((candidate) => candidate.getAttribute("aria-label") === action.target)!;
      return { found: slider, disabled: slider?.disabled, perform: () => setRange(slider, action.value) };
    }
    case "toggle": {
      const toggle = toggles().find((candidate) => candidate.getAttribute("aria-label") === action.target)!;
      return { found: toggle, disabled: toggle?.disabled, perform: () => click(toggle) };
    }
    case "color": {
      const picker = pickers.get(action.target)!;
      return {
        found: picker,
        disabled: picker?.disabled,
        perform: () => act(() => picker.onChange(action.value)),
      };
    }
  }
}

function describeAction(state: RecordedState, action: RecordedAction) {
  return `${state.id}: ${action.kind} ${action.target}${"value" in action ? ` = ${JSON.stringify(action.value)}` : ""}`;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const states = recorded.states.map((state) => [state.id, state] as const);

describe("TrackerCardColorControls against the recordings", () => {
  it("covers every recorded state and action", () => {
    expect(recorded.states).toHaveLength(50);
    const actions = recorded.states.flatMap((state) => state.actions);
    expect(actions).toHaveLength(1643);
    expect(actions.every((action) => Boolean(action.skipped) !== Array.isArray(action.onChange))).toBe(true);
  });

  it.each(states)("%s renders as recorded", (_id, state) => {
    mount(state.props);
    expect(snapshot()).toStrictEqual(withDecisionOne(state.initial));
  });

  it.each(states)("%s hands over the recorded config for every action", (_id, state) => {
    for (const action of state.actions) {
      mount(state.props);
      const control = controlFor(action);
      const label = describeAction(state, action);
      expect(control.found, label).toBeTruthy();
      if (action.skipped) {
        expect(control.disabled, label).toBe(true);
        continue;
      }
      expect(control.disabled, label).toBeFalsy();
      control.perform();
      expect(
        onChange.mock.calls.map(([config]) => config),
        label,
      ).toStrictEqual(action.onChange!.map((index) => recorded.configs[index]));
    }
  });

  it.each(states)("%s collapses and expands without handing anything over", (_id, state) => {
    mount(state.props);
    expect(state.collapse.onChange).toEqual([]);

    click(header());
    expect(collapsedSnapshot()).toStrictEqual(state.collapse.collapsed);
    expect(panel().children).toHaveLength(1);

    click(header());
    expect(state.collapse.reexpandedEqualsInitial).toBe(true);
    expect(snapshot()).toStrictEqual(withDecisionOne(state.initial));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TrackerCardColorControls while disabled", () => {
  const disabledStates = states.filter(([, state]) => state.props.disabled);

  it("has recorded disabled states in both variants", () => {
    expect(disabledStates.map(([id]) => id)).toEqual([
      "disabled-custom",
      "disabled-chat",
      "compact-disabled-custom",
      "compact-disabled-chat",
    ]);
  });

  // jsdom still delivers input events to a disabled slider, which a browser never does; nothing may come of them.
  it.each(disabledStates)("%s ignores forced clicks, slides, toggles and picker changes", (_id, state) => {
    expect(state.actions.every((action) => Boolean(action.skipped))).toBe(true);
    for (const action of state.actions) {
      mount(state.props);
      const control = controlFor(action);
      expect(control.disabled, describeAction(state, action)).toBe(true);
      control.perform();
      expect(onChange, describeAction(state, action)).not.toHaveBeenCalled();
    }
  });

  it.each(disabledStates)("%s still collapses from the header", (_id, state) => {
    mount(state.props);
    expect(header().disabled).toBe(false);
    click(header());
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(bodyButtons()).toHaveLength(0);
  });
});

describe("TrackerCardColorControls behavior", () => {
  it("marks the selected Source, Stage and Finish buttons with aria-pressed (decision 1)", () => {
    const props: RecordedProps = {
      value: {
        mode: "custom",
        portraitStageBackground: "soft",
        materialBrightness: 44,
        glowIntensity: 82,
        contrastIntensity: 86,
      },
      chatColors: {},
      entityLabel: "Persona",
    };
    mount(props);
    const pressed = bodyButtons()
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.textContent);
    expect(pressed).toEqual(["Custom", "Haze", "Vivid"]);
    expect(bodyButtons().every((button) => ["true", "false"].includes(button.getAttribute("aria-pressed")!))).toBe(
      true,
    );
  });

  it.each(["full", "compact"] as const)("puts each finish slider's tooltip on its whole row (%s)", (variant) => {
    mount({ value: { mode: "default" }, chatColors: {}, entityLabel: "Character", variant });
    const finishSliders = sliders();
    expect(finishSliders).toHaveLength(3);
    for (const slider of finishSliders) {
      const row = slider.closest("label")!;
      expect(row.getAttribute("title")).toBe(slider.getAttribute("title"));
      expect(row.textContent).toMatch(/^(Material|Glow|Contrast)\d+%$/);
    }
  });

  it("keeps no copy of the config: a caller that ignores onChange sees no change", () => {
    const state = recorded.states.find((candidate) => candidate.id === "chat-both")!;
    mount(state.props);
    click(bodyButtons().find((button) => button.textContent === "Custom")!);
    setRange(sliders()[0]!, 12);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(snapshot()).toStrictEqual(withDecisionOne(state.initial));
  });

  it("shows the new value on the next render", () => {
    mount({ value: { mode: "chat" }, chatColors: {}, entityLabel: "Character" });
    act(() => {
      root!.render(
        <TrackerCardColorControls
          value={{ mode: "default", portraitStageBackground: "plain" }}
          onChange={onChange}
          chatColors={{}}
          entityLabel="Character"
        />,
      );
    });
    expect(header().querySelector("[data-summary]")!.textContent).toBe("Default, plain stage, finish M/G/C 50/25/55.");
    expect(groups()).toEqual(["Source", "Stage", "Finish"]);
  });

  it("treats chat colors that aren't text as no color", () => {
    // An imported card can carry a number, object or array where a color string belongs.
    const badChatColors = {
      nameColor: 16711680,
      dialogueColor: ["#fff"],
      boxColor: { r: 255 },
    } as unknown as TrackerCardPaintColors;
    mount({ value: { mode: "chat" }, chatColors: badChatColors, entityLabel: "Character" });
    expect(header().querySelector("[data-summary]")!.textContent).toBe(
      "Chat colors, ambient stage, finish M/G/C 50/45/55.",
    );
    expect(headerSnapshot().swatches.every((swatch) => !swatch.backgroundColor && !swatch.background)).toBe(true);
    expect(rows().every((row) => row.textContent!.includes("none"))).toBe(true);

    click(bodyButtons().find((button) => button.textContent === "Custom")!);
    const committed = onChange.mock.lastCall![0];
    expect(committed.mode).toBe("custom");
    // Custom starts from the chat colors, and none of these are colors.
    for (const field of ["nameColor", "dialogueColor", "boxColor"] as const) {
      expect([undefined, ""]).toContain(committed[field]);
    }
  });
});
