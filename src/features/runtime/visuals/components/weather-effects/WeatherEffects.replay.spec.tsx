import { describe, expect, it } from "vitest";
import { diffStep, loadScenarios, replayScenario, type Scenario } from "./weather-replay-harness";

// Fixed-random recordings of the old effects (test-fixtures/README.md). With Math.random returning one
// constant, the order of random draws doesn't matter, so every step must match exactly.
const FILES = ["recorded-scenes.json", "recorded-timelines.json", "recorded-seeded.json"];

const fixedRandomScenarios = FILES.flatMap((file) =>
  loadScenarios(file)
    .filter((scenario) => typeof scenario.random === "number")
    .map((scenario) => [file, scenario] as [string, Scenario]),
);

describe("WeatherEffects replays the recorded old effects", () => {
  it("covers every fixed-random scenario", () => {
    expect(fixedRandomScenarios.length).toBe(310);
  });

  it.each(fixedRandomScenarios.map(([file, scenario]) => [`${file} ${scenario.id}`, scenario] as const))(
    "%s",
    async (_name, scenario) => {
      const problems: string[] = [];
      await replayScenario(scenario, (step, index) => {
        const recorded = scenario.steps[index];
        expect(step.step).toEqual(recorded.step);
        problems.push(...diffStep(step, recorded));
      });
      expect(problems).toEqual([]);
    },
  );
});
