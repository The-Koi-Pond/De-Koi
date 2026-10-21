// Snapshots of the exact prompt De-Koi sends the model, one plain-text file per fixture, so any prompt
// change shows up as a readable diff in the PR. No model is called.
// Update after an intended prompt change: pnpm test:prompt-snapshots:update
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptSnapshotFixtures } from "./fixtures";
import { captureFirstModelRequest, freezeRuntime, renderPromptSnapshot, snapshotStorage } from "./harness";

describe("prompt snapshots", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const fixture of promptSnapshotFixtures()) {
    it(`${fixture.name} prompt matches ${fixture.name}.txt`, async () => {
      freezeRuntime();
      const request = await captureFirstModelRequest(snapshotStorage(fixture.db), fixture.input);
      await expect(renderPromptSnapshot(fixture.title, request)).toMatchFileSnapshot(`./${fixture.name}.txt`);
    });
  }
});
