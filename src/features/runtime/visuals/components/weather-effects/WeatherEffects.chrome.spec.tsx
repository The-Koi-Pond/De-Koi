import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffOps, expandOps, replayScenario, type Scenario } from "./weather-replay-harness";

// Real-Chrome recording of the old effects in the app (fixed random 0.5, manual frame clock; see
// test-fixtures/README.md). `events`/`ran` also count other app code's frames there, so only each
// frame's canvas calls and the canvas size are compared.
interface ChromeScene {
  label: string;
  scene: { weather: string | null; time: string | null };
  viewport: { width: number; height: number };
  steps: { ts: number; log: Parameters<typeof expandOps>[0]; size: [number, number] }[];
}

const fixture = join(dirname(fileURLToPath(import.meta.url)), "test-fixtures", "recorded-chrome.json");
const { scenes } = JSON.parse(readFileSync(fixture, "utf8")) as { scenes: ChromeScene[] };

describe("WeatherEffects replays the real-Chrome recording", () => {
  it("covers every recorded scene", () => {
    expect(scenes.length).toBe(32);
  });

  it.each(scenes.map((scene) => [scene.label, scene] as const))("%s", async (_label, chrome) => {
    const scenario: Scenario = {
      id: chrome.label,
      props: { weather: chrome.scene.weather, timeOfDay: chrome.scene.time },
      random: 0.5,
      rect: chrome.steps[0].size,
      inner: [chrome.viewport.width, chrome.viewport.height],
      dpr: 1,
      steps: [["mount"] as const, ...chrome.steps.map(({ ts }) => ["frame", ts] as const)].map((step) => ({
        step: [...step] as Scenario["steps"][number]["step"],
        html: "",
        size: null,
        events: [],
      })),
    };

    const [, ...frames] = await replayScenario(scenario);
    const problems = chrome.steps.flatMap((recorded, i) => {
      const diff = diffOps(frames[i].ops ?? [], expandOps(recorded.log));
      const size = JSON.stringify(frames[i].size) === JSON.stringify(recorded.size) ? null : "size";
      return [diff, size].filter(Boolean).map((problem) => `ts ${recorded.ts}: ${problem}`);
    });
    expect(problems).toEqual([]);
  });
});
