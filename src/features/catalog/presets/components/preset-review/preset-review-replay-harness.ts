// Replays the AI Review recordings (test-fixtures/README.md): the Overview replay harness (same worlds, fakes, settling
// and snapshot) plus the review steps. The spec files install the fakes with `vi.mock` (see
// `fake-preset-review-apis.ts`).
import { act } from "react";
import {
  PresetOverviewHarness,
  worldFor,
  type Recording,
  type Scenario,
  type ScenarioWorld,
  type Snapshot,
  type Step,
  type StepResult,
} from "../preset-overview/preset-overview-replay-harness";
import { fakePresetReviewApis, REVIEW_OPS, type ThrowSpec } from "./fake-preset-review-apis";

const isReviewOp = (op: unknown): op is (typeof REVIEW_OPS)[number] => (REVIEW_OPS as readonly unknown[]).includes(op);

function isTag(value: object, key: string): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === key;
}

/** Turns the recordings' encoded values (`$undefined`, `$number`) back into what they stand for. */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (isTag(record, "$undefined")) return undefined;
  if (isTag(record, "$number")) return Number(record.$number);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decode(item)]));
}

export class PresetReviewHarness extends PresetOverviewHarness {
  constructor(world: ScenarioWorld, presetDetailId: string | null) {
    super(world, presetDetailId);
    fakePresetReviewApis.reset();
  }

  override async unmount(): Promise<string[]> {
    fakePresetReviewApis.releaseAll();
    return super.unmount();
  }

  /** The first `select` in the page (the connection picker). */
  select(): HTMLSelectElement {
    const found = this.element.querySelector("select");
    if (!found) throw new Error("no select");
    return found;
  }

  /** The button whose whole text is `Start Review` or `Reviewing…`. */
  startButton(): HTMLButtonElement {
    try {
      return this.buttonWithText("Start Review");
    } catch {
      return this.buttonWithText("Reviewing…");
    }
  }

  /** Sets the select's value through the native setter and dispatches a bubbling `change`. */
  async choose(value: string) {
    const select = this.select();
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await this.settle();
  }

  /** Wakes a scripted stream inside `act`, then settles. */
  private async wake(run: () => void) {
    await act(async () => {
      run();
    });
    await this.settle();
  }

  override async run(step: Step): Promise<Partial<Snapshot>> {
    const [kind, ...args] = step;
    switch (kind) {
      case "realMode":
        fakePresetReviewApis.useRealReviewer();
        await this.settle();
        return {};
      case "hold":
      case "fail":
      case "release": {
        const op = args[0];
        if (!isReviewOp(op)) return super.run(step);
        if (kind === "release") {
          await this.wake(() => fakePresetReviewApis.release(op));
          return {};
        }
        if (kind === "hold") fakePresetReviewApis.hold(op);
        else fakePresetReviewApis.failNext(op, args[1] as string);
        await this.settle();
        return {};
      }
      case "choose":
        await this.choose(args[0] as string);
        return {};
      case "start":
        await this.click(this.startButton());
        return {};
      case "focusSelect":
        await this.focus(this.select());
        return {};
      case "focusStart":
        await this.focus(this.startButton());
        return {};
      case "emit":
        await this.wake(() => fakePresetReviewApis.emit(decode(args[0]), args[1] as number | undefined));
        return {};
      case "endReview":
        await this.wake(() => fakePresetReviewApis.end(args[0] as number | undefined));
        return {};
      case "throwReview":
        await this.wake(() => fakePresetReviewApis.throwNewest(args[0] as ThrowSpec));
        return {};
      default:
        return super.run(step);
    }
  }
}

/** Mounts a fresh editor for a recorded scenario and replays every step. */
export async function replayReviewScenario(recording: Recording, scenario: Scenario) {
  const presetDetailId = scenario.presetDetailId === undefined ? "preset-1" : scenario.presetDetailId;
  const harness = new PresetReviewHarness(worldFor(recording, scenario), presetDetailId);
  const results: StepResult[] = [];
  let unhandledAfterUnmount: string[] = [];
  try {
    for (const step of scenario.pre) await harness.run(step);
    for (const recorded of scenario.steps) results.push(await harness.record(recorded.step));
  } finally {
    unhandledAfterUnmount = await harness.unmount();
  }
  return { results, unhandledAfterUnmount };
}
