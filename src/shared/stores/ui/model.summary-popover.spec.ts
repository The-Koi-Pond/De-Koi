import { describe, expect, it } from "vitest";

import { DEFAULT_SUMMARY_POPOVER_SETTINGS, normalizeSummaryPopoverSettings } from "./model";

describe("summary popover UI settings", () => {
  it("defaults manual summary generation to the full chat", () => {
    expect(DEFAULT_SUMMARY_POPOVER_SETTINGS.sourceMode).toBe("all");
  });

  it("preserves the full-chat source mode when normalizing persisted settings", () => {
    expect(normalizeSummaryPopoverSettings({ sourceMode: "all" }).sourceMode).toBe("all");
  });
});
