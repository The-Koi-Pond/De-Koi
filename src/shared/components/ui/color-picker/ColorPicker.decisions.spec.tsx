import { afterEach, describe, expect, it } from "vitest";
import { PickerHarness, type RecordedProps } from "./color-picker-replay-harness";

const NAME: RecordedProps = { label: "Name Display Color", gradient: true };
const BOX: RecordedProps = { label: "Message Box Color" };
const TO_RIGHT = "linear-gradient(to right, #aa0000, #00aa00)";

let harnesses: PickerHarness[] = [];

function mount(props: RecordedProps, value: string, handsBack = true) {
  const harness = new PickerHarness(props, value, handsBack);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  harnesses.forEach((harness) => harness.unmount());
  harnesses = [];
});

function pressed(harness: PickerHarness, selector: string) {
  return [...harness.element.querySelectorAll(selector)].map((element) => element.getAttribute("aria-pressed"));
}

describe("decision 1: selected options are announced with aria-pressed", () => {
  it("marks the selected Solid/Gradient button and moves the mark when the mode switches", () => {
    const picker = mount(NAME, "#ff6b6b");
    picker.run({ do: "toggle" });
    expect(picker.buttonByText("Solid").getAttribute("aria-pressed")).toBe("true");
    expect(picker.buttonByText("Gradient").getAttribute("aria-pressed")).toBe("false");

    picker.run({ do: "click", text: "Gradient" });
    expect(picker.buttonByText("Solid").getAttribute("aria-pressed")).toBe("false");
    expect(picker.buttonByText("Gradient").getAttribute("aria-pressed")).toBe("true");
  });

  it("gives every solid preset aria-pressed, true only for the one equal to the value", () => {
    const picker = mount(BOX, "#22a6b3");
    picker.run({ do: "toggle" });
    const states = pressed(picker, "button[aria-label^='Use #']");
    expect(states).toHaveLength(20);
    expect(states.filter((state) => state === "true")).toHaveLength(1);
    expect(states.filter((state) => state === "false")).toHaveLength(19);
    expect(picker.byName("Use #22a6b3 for Message Box Color").getAttribute("aria-pressed")).toBe("true");
  });

  it("gives every gradient preset aria-pressed, true only for the one equal to the value", () => {
    const picker = mount(NAME, "linear-gradient(135deg, #667eea, #764ba2)");
    picker.run({ do: "toggle" });
    const states = pressed(picker, "button[aria-label^='Use gradient preset']");
    expect(states).toHaveLength(12);
    expect(states.filter((state) => state === "false")).toHaveLength(11);
    expect(picker.byName("Use gradient preset 9 for Name Display Color").getAttribute("aria-pressed")).toBe("true");
  });

  it("marks no preset when the value matches none", () => {
    const picker = mount(BOX, "#ABCDEF");
    picker.run({ do: "toggle" });
    expect(new Set(pressed(picker, "button[aria-label^='Use #']"))).toEqual(new Set(["false"]));
  });
});

describe("decision 2: Clear says what it clears", () => {
  it("names Clear after its picker while the visible word stays Clear", () => {
    const name = mount(NAME, "#ff6b6b");
    const box = mount(BOX, "rgba(255, 0, 0, 0.5)");
    for (const [picker, label] of [
      [name, "Name Display Color"],
      [box, "Message Box Color"],
    ] as const) {
      const clear = picker.buttonByText("Clear");
      expect(clear.getAttribute("aria-label")).toBe(`Clear ${label}`);
      expect(clear.textContent).toBe("Clear");
    }
  });
});

describe("decision 3: the selected mode button hands nothing over", () => {
  it("leaves a solid value alone when Solid is clicked in solid mode", () => {
    const picker = mount(NAME, "red");
    picker.run({ do: "toggle" });
    expect(picker.run({ do: "click", text: "Solid" })).toEqual([]);
    expect(picker.trigger().getAttribute("aria-label")).toBe("Name Display Color: red");
    expect((picker.byName("Name Display Color hex or CSS color") as HTMLInputElement).value).toBe("red");
  });

  it("leaves a gradient value alone when Gradient is clicked in gradient mode", () => {
    const picker = mount(NAME, TO_RIGHT);
    picker.run({ do: "toggle" });
    expect(picker.run({ do: "click", text: "Gradient" })).toEqual([]);
    expect(picker.trigger().getAttribute("aria-label")).toBe(`Name Display Color: ${TO_RIGHT}`);
  });

  it("hands nothing over for Gradient in gradient mode after the caller emptied the value", () => {
    const picker = mount(NAME, "linear-gradient(45deg, #111111, #222222, #333333)");
    picker.run({ do: "toggle" });
    picker.run({ do: "value", value: "" });
    expect(picker.run({ do: "click", text: "Gradient" })).toEqual([]);
    expect(picker.findButtonByText("Clear")).toBeNull();
  });

  it("still hands over a value when the mode actually switches", () => {
    const picker = mount(NAME, "red");
    picker.run({ do: "toggle" });
    expect(picker.run({ do: "click", text: "Gradient" })).toEqual(["linear-gradient(90deg, #ff6b6b, #ffd93d)"]);
    expect(picker.run({ do: "click", text: "Solid" })).toEqual(["#ff6b6b"]);
  });
});
