import { describe, expect, it } from "vitest";
import { DISCOVERY_ENTRIES } from "../discovery-registry";
import { DISCOVERY_TASKS, filterEntriesForDiscoveryTask } from "./discovery-tasks";

describe("discovery task groups", () => {
  it("offers the six approved user goals with populated results", () => {
    expect(DISCOVERY_TASKS.map(({ label }) => label)).toEqual([
      "Start chatting",
      "Customize characters and worlds",
      "Improve responses",
      "Add images, voice, or music",
      "Import or back up data",
      "Troubleshoot something",
    ]);
    for (const task of DISCOVERY_TASKS) {
      expect(filterEntriesForDiscoveryTask(DISCOVERY_ENTRIES, task.id).length).toBeGreaterThan(0);
    }
  });
});
