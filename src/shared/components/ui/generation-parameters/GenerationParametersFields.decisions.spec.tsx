import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldsHarness, trimmedText } from "./fields-replay-harness";
import {
  CHAT_PARAMETER_DEFAULTS,
  GenerationParametersFields,
  serviceTierOptionsForProvider,
  type EditableGenerationParameters,
} from "./index";

const FULL: EditableGenerationParameters = {
  ...CHAT_PARAMETER_DEFAULTS,
  reasoningEffort: "medium",
  verbosity: null,
  serviceTier: "flex",
  customThinkingTags: [
    { open: "<a>", close: "</a>" },
    { open: "<b>", close: "</b>" },
  ],
  customParameters: { top_a: 0.1 },
};
const OPENAI_TIERS = serviceTierOptionsForProvider("openai");

const INVALID_JSON = "Invalid JSON. Check quotes, commas, and boolean casing.";
const NOT_OBJECT = "Custom parameters must be a JSON object, not an array or scalar.";
const HINT = "Must be a JSON object. Use lowercase true, false, and null.";

let harnesses: FieldsHarness[] = [];

function mount(value: EditableGenerationParameters = FULL, handsBack = true) {
  const harness = new FieldsHarness(value, OPENAI_TIERS, handsBack);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  harnesses.forEach((harness) => harness.unmount());
  harnesses = [];
  document.body.replaceChildren();
});

function optionStates(harness: FieldsHarness, group: "tier" | "reasoning" | "verbosity") {
  return harness.view.optionButtons(group)!.map((button) => [trimmedText(button), button.getAttribute("aria-pressed")]);
}

describe("decision 1: option buttons announce the selection with aria-pressed", () => {
  it("gives every option button aria-pressed, true only for the selected option of each group", () => {
    const fields = mount();
    expect(optionStates(fields, "tier")).toEqual([
      ["Unset", "false"],
      ["Auto", "false"],
      ["Default", "false"],
      ["Flex", "true"],
      ["Scale", "false"],
      ["Priority", "false"],
    ]);
    expect(optionStates(fields, "reasoning").filter(([, pressed]) => pressed === "true")).toEqual([["Medium", "true"]]);
    expect(optionStates(fields, "verbosity")).toEqual([
      ["None", "true"],
      ["Low", "false"],
      ["Medium", "false"],
      ["High", "false"],
    ]);
  });

  it("moves the mark when another option is chosen", () => {
    const fields = mount();
    fields.run({ do: "click", group: "reasoning", option: "X High" });
    expect(optionStates(fields, "reasoning").filter(([, pressed]) => pressed === "true")).toEqual([["X High", "true"]]);
  });

  it("presses nothing when the stored value is not one of the options", () => {
    const fields = mount({ ...FULL, serviceTier: "standard_only" });
    expect(new Set(optionStates(fields, "tier").map(([, pressed]) => pressed))).toEqual(new Set(["false"]));
  });
});

describe("decision 2: fields are named by their labels", () => {
  const LABELS = [
    "Temperature",
    "Max Output Tokens",
    "Top P",
    "Top K",
    "Frequency",
    "Presence",
    "Assistant Prefill",
    "Custom Parameters",
  ];

  it("names each number field and text area by the visible label above it", () => {
    const fields = mount();
    for (const label of LABELS) {
      const field = fields.view.byName<HTMLInputElement | HTMLTextAreaElement>(label);
      expect(["INPUT", "TEXTAREA"], label).toContain(field.tagName);
      expect(trimmedText(field.previousElementSibling!), label).toBe(label);
    }
  });

  it("names the tag fields and trash buttons by row, from 1", () => {
    const fields = mount();
    const named = [...fields.element.querySelectorAll("[aria-label*='ustom thinking tag']")].map((element) => [
      element.tagName,
      element.getAttribute("aria-label"),
    ]);
    expect(named).toEqual([
      ["INPUT", "Custom thinking tag 1 open"],
      ["INPUT", "Custom thinking tag 1 close"],
      ["BUTTON", "Remove custom thinking tag 1"],
      ["INPUT", "Custom thinking tag 2 open"],
      ["INPUT", "Custom thinking tag 2 close"],
      ["BUTTON", "Remove custom thinking tag 2"],
    ]);
  });

  it("keeps the help buttons' names", () => {
    const fields = mount();
    expect(fields.view.findByName("Help: Controls randomness.")?.tagName).toBe("BUTTON");
  });
});

describe("decision 3: every button is a plain button", () => {
  it("has type=button on every button and submits no surrounding form", () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
          <GenerationParametersFields value={FULL} onChange={() => {}} serviceTierOptions={OPENAI_TIERS} />
        </form>,
      ),
    );
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(20);
    expect(buttons.filter((button) => button.getAttribute("type") !== "button")).toEqual([]);
    for (const button of buttons) act(() => button.click());
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("decision 4: rejected Custom Parameters keep their text and say why", () => {
  function enter(fields: FieldsHarness, text: string) {
    fields.run({ do: "focus", field: "customParameters" });
    fields.run({ do: "fill", field: "customParameters", text });
    return fields.run({ do: "blur", field: "customParameters" });
  }

  it("keeps invalid JSON in the field, shows the invalid JSON error and hands nothing over", () => {
    const fields = mount();
    expect(enter(fields, "{bad")).toEqual([]);
    const shown = fields.view.snapshot();
    expect(shown.values.customParameters).toBe("{bad");
    expect(shown.cpNote).toBe(INVALID_JSON);
    expect(fields.view.field("customParameters").nextElementSibling!.className).toContain("text-amber-500");
  });

  it("names the not-an-object error for arrays and scalars", () => {
    for (const text of ["[1]", "null", "5", '"x"', "[True]"]) {
      const fields = mount();
      expect(enter(fields, text), text).toEqual([]);
      expect(fields.view.snapshot().cpNote, text).toBe(NOT_OBJECT);
      expect(fields.view.snapshot().values.customParameters, text).toBe(text);
    }
  });

  it("keeps the error through focusing again and leaving again, still handing nothing over", () => {
    const fields = mount();
    enter(fields, "{bad");
    fields.run({ do: "focus", field: "customParameters" });
    expect(fields.view.snapshot().cpNote).toBe(INVALID_JSON);
    expect(fields.run({ do: "blur", field: "customParameters" })).toEqual([]);
    expect(fields.view.snapshot().values.customParameters).toBe("{bad");
  });

  it("clears the error and shows the hint again on the next edit", () => {
    const fields = mount();
    enter(fields, "{bad");
    fields.run({ do: "focus", field: "customParameters" });
    fields.run({ do: "fill", field: "customParameters", text: "{ba" });
    expect(fields.view.snapshot().cpNote).toBe(HINT);
    expect(fields.view.snapshot().values.customParameters).toBe("{ba");
  });

  it("follows an outside change while not focused, clearing the error", () => {
    const fields = mount();
    enter(fields, "{bad");
    fields.run({ do: "rerender", patch: { customParameters: { z: 1 } } });
    expect(fields.view.snapshot().values.customParameters).toBe('{\n  "z": 1\n}');
    expect(fields.view.snapshot().cpNote).toBe(HINT);
  });

  it("keeps the text and error when the caller hands back an equal new object", () => {
    const fields = mount();
    enter(fields, "{bad");
    fields.run({ do: "rerender", patch: { customParameters: { top_a: 0.1 } } });
    expect(fields.view.snapshot().values.customParameters).toBe("{bad");
    expect(fields.view.snapshot().cpNote).toBe(INVALID_JSON);
  });

  it("still accepts a good object afterwards", () => {
    const fields = mount();
    enter(fields, "{bad");
    fields.run({ do: "focus", field: "customParameters" });
    fields.run({ do: "fill", field: "customParameters", text: '{"b":2}' });
    const calls = fields.run({ do: "blur", field: "customParameters" }) as EditableGenerationParameters[];
    expect(calls.map((call) => call.customParameters)).toEqual([{ b: 2 }]);
    expect(fields.view.snapshot().cpNote).toBe(HINT);
  });
});
