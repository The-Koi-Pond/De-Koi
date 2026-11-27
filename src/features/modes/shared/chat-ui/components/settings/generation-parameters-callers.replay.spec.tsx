import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdvancedHarness,
  SetupHarness,
  type AdvancedScenario,
  type CallerRecording,
  type SetupScenario,
} from "./generation-parameters-callers-replay-harness";
import { encode } from "../../../../../../shared/components/ui/generation-parameters/recorded-encoding";
import advanced1Json from "../../../../../../shared/components/ui/generation-parameters/test-fixtures/recorded-advanced-1.json";
import advanced2Json from "../../../../../../shared/components/ui/generation-parameters/test-fixtures/recorded-advanced-2.json";
import setupJson from "../../../../../../shared/components/ui/generation-parameters/test-fixtures/recorded-setup.json";

const savedDefaults = vi.hoisted(() => [] as unknown[]);

vi.mock("../../../../../catalog/connections/index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSaveConnectionDefaults: () => ({
    mutate: (value: unknown) => savedDefaults.push(encode(value)),
    isPending: false,
  }),
}));

// Decision 6 changed only the defaults' starting reasoning effort (Unset, was X High); the callers' logic is replayed
// against the defaults the recordings were made with.
vi.mock("../../../../../../shared/components/ui/generation-parameters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../shared/components/ui/generation-parameters")>();
  return {
    ...actual,
    CHAT_PARAMETER_DEFAULTS: { ...actual.CHAT_PARAMETER_DEFAULTS, reasoningEffort: "xhigh" },
    ROLEPLAY_PARAMETER_DEFAULTS: { ...actual.ROLEPLAY_PARAMETER_DEFAULTS, reasoningEffort: "xhigh" },
  };
});

// No caller recording leaves Custom Parameters with rejected text (the only change decision 4 makes to what the
// fields show), and the callers read none of the names or attributes decisions 1-3 add, so every recorded step
// is expected exactly as recorded: there is no table of intended differences here.

const ADVANCED: ReadonlyArray<[string, CallerRecording<AdvancedScenario>]> = [
  ["recorded-advanced-1.json", advanced1Json as unknown as CallerRecording<AdvancedScenario>],
  ["recorded-advanced-2.json", advanced2Json as unknown as CallerRecording<AdvancedScenario>],
];
const SETUP = setupJson as unknown as CallerRecording<SetupScenario>;

const advancedScenarios = ADVANCED.flatMap(([file, recording]) =>
  recording.scenarios.map((scenario) => [`${file} ${scenario.id}`, recording, scenario] as const),
);

afterEach(() => {
  savedDefaults.length = 0;
});

describe("AdvancedParametersSection replays the recordings with the new module", () => {
  it("covers every recorded scenario and step", () => {
    expect(advancedScenarios).toHaveLength(804);
    expect(advancedScenarios.reduce((sum, [, , scenario]) => sum + scenario.rec.length, 0)).toBe(522 + 527);
  });

  it.each(advancedScenarios)("%s", (_name, recording, scenario) => {
    const harness = new AdvancedHarness(recording, scenario, savedDefaults);
    try {
      expect(harness.start(), "start").toEqual(scenario.start);
      scenario.rec.forEach((recorded, index) => {
        const label = `step ${index} ${JSON.stringify(recorded.action)}`;
        const ran = harness.run(recorded.action);
        if (recorded.absent) {
          expect(ran, `${label} finds no button`).toBe(false);
          return;
        }
        expect(ran, `${label} finds its button`).toBe(true);
        const { action: _action, ...expected } = recorded;
        const actual = harness.shown("fields" in recorded);
        expect(actual, label).toEqual(expected);
        expect(JSON.stringify(actual.chatPatches), `${label} patch key order`).toBe(
          JSON.stringify(expected.chatPatches),
        );
        expect(JSON.stringify(actual.connectionDefaults), `${label} defaults key order`).toBe(
          JSON.stringify(expected.connectionDefaults),
        );
      });
    } finally {
      harness.unmount();
    }
  });
});

describe("useSetupParameters and SetupParametersPanel replay the recordings with the new module", () => {
  it("covers every recorded scenario and step", () => {
    expect(SETUP.scenarios).toHaveLength(200);
    expect(SETUP.scenarios.reduce((sum, scenario) => sum + scenario.rec.length, 0)).toBe(440);
  });

  it.each(SETUP.scenarios.map((scenario) => [scenario.id, scenario] as const))("%s", (_id, scenario) => {
    const harness = new SetupHarness(SETUP, scenario);
    try {
      expect(harness.start(), "start").toEqual(scenario.start);
      scenario.rec.forEach((recorded, index) => {
        const label = `step ${index} ${JSON.stringify(recorded.action)}`;
        harness.run(recorded.action);
        const { action: _action, ...expected } = recorded;
        const actual = harness.shown();
        expect(actual, label).toEqual(expected);
        expect(JSON.stringify(actual.chatParameters), `${label} key order`).toBe(
          JSON.stringify(expected.chatParameters),
        );
        expect(JSON.stringify(actual.value), `${label} value key order`).toBe(JSON.stringify(expected.value));
      });
    } finally {
      harness.unmount();
    }
  });
});
