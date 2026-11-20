// Checks the real-Chrome recording (test-fixtures/README.md) against the form module: for every create and
// update the old editor sent, the form rebuilt from what the screen showed just before the save gives the
// same payload, field for field and in the same key order.
import { describe, expect, it } from "vitest";
import chromeJson from "./test-fixtures/recorded-chrome.json";
import { PARAMETER_TYPES, newToolForm, toolSavePayload, type ToolForm, type ToolParameter } from "./tool-form";

interface ChromeField {
  tag: string;
  placeholder?: string | null;
  value: string;
  checked?: boolean;
  selectedIndex?: number;
  options?: string[];
}

interface ChromeCall {
  command: string;
  args: { entity: string; value?: Record<string, unknown>; patch?: Record<string, unknown> };
}

interface ChromeStep {
  label: string;
  open: boolean;
  text?: string;
  fields?: ChromeField[];
  calls: ChromeCall[];
}

interface ChromeFlow {
  flow: string;
  viewport: { width: number; height: number };
  scheme: string;
  steps: ChromeStep[];
}

const flows = (chromeJson as unknown as { flows: ChromeFlow[] }).flows;
const STATIC_SELECTED = "WebhookReturns a fixed string when called.";

/** The form as the screen showed it (enabled can't be seen, so the caller gives it). */
function formFromScreen(step: ChromeStep, sent: Record<string, unknown>, enabled: boolean): ToolForm {
  const fields = step.fields ?? [];
  const value = (placeholder: string) => fields.find((field) => field.placeholder === placeholder)?.value ?? "";
  const sentProperties = (sent.parametersSchema as { properties: Record<string, { type: string }> }).properties;
  const parameters: ToolParameter[] = [];
  fields.forEach((field, index) => {
    if (field.placeholder !== "param_name") return;
    const select = fields[index + 1]!;
    const required = fields[index + 2]!;
    const description = fields[index + 3]!;
    let type = select.value;
    const storedType = sentProperties[field.value]?.type;
    if (storedType !== undefined && !(PARAMETER_TYPES as readonly string[]).includes(storedType)) {
      // A stored type outside the five: the old screen showed the first option (as README says real Chrome
      // does) while the row still held its own type. Decision 5 shows it as a sixth option instead.
      expect(select).toMatchObject({ value: "string", selectedIndex: 0, options: [...PARAMETER_TYPES] });
      type = storedType;
    }
    parameters.push({
      name: field.value,
      type,
      description: description.value,
      required: required.checked === true,
      extras: {},
    });
  });
  const isStatic = (step.text ?? "").includes(STATIC_SELECTED);
  return {
    ...newToolForm(),
    name: value("tool_name"),
    description: value("Describe what this tool does — the AI reads this to decide when to call it…"),
    executionType: isStatic ? "static" : "webhook",
    staticResult: isStatic ? value('{"result": "OK"}') : "",
    webhookUrl: isStatic ? "" : value("https://api.example.com/my-tool"),
    parameters,
    enabled,
  };
}

const saves = flows.flatMap((flow) =>
  flow.steps.flatMap((step, index) =>
    step.calls
      .filter((call) => call.command === "storage_create" || call.command === "storage_update")
      .map((call) => ({
        name: `${flow.flow} ${flow.viewport.width} ${flow.scheme}: ${step.label}`,
        flow,
        step,
        before: flow.steps[index - 1]!,
        call,
      })),
  ),
);

describe("the real-Chrome recording", () => {
  it("has a create or update for every save in every flow, viewport and theme", () => {
    expect(flows).toHaveLength(12);
    // new: create + update; stored: update; legacy: three updates. Four viewport/theme runs.
    expect(saves).toHaveLength(4 * (2 + 1 + 3));
    expect(saves.every(({ call }) => call.args.entity === "custom-tools")).toBe(true);
  });

  it("never sends anything that could reach a model or a webhook", () => {
    for (const flow of flows)
      for (const step of flow.steps)
        for (const call of step.calls) expect(call.command, `${flow.flow} ${step.label}`).toMatch(/^storage_/);
  });

  it("never scrolls sideways", () => {
    for (const flow of flows)
      for (const step of flow.steps as Array<ChromeStep & { scrollWidth?: number; innerWidth?: number }>)
        if (step.open) expect(step.scrollWidth, `${flow.flow} ${step.label}`).toBeLessThanOrEqual(step.innerWidth!);
  });

  it.each(saves.map((save) => [save.name, save] as const))("%s: the same payload", (_name, save) => {
    const sent = (save.call.args.value ?? save.call.args.patch)!;
    // The imported legacy tool was switched off; decision 1 keeps it off, the old editor switched it on.
    const keepsOff = save.flow.flow === "legacy" && save.step.label === "save unchanged";
    expect(sent.enabled).toBe(true);
    const payload = toolSavePayload(formFromScreen(save.before, sent, !keepsOff));
    const expected = keepsOff ? { ...sent, enabled: false } : sent;
    // Decision 5 would also keep that tool's `enum`, `items` and `additionalProperties`, which the screen
    // can't show; the component tests cover them.
    expect(JSON.stringify(payload)).toBe(JSON.stringify(expected));
  });
});
