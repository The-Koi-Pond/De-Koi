import { describe, expect, it } from "vitest";
import { dekiApprovalExpiryLabel, parseDekiDataCommand } from "./DekiDataApprovalCard";

describe("dekiApprovalExpiryLabel", () => {
  const now = Date.parse("2026-06-25T12:00:00.000Z");

  it("never gives an expired approval more time", () => {
    expect(dekiApprovalExpiryLabel("2026-06-25T11:59:59.000Z", now)).toBeNull();
    expect(dekiApprovalExpiryLabel("2026-06-25T12:00:00.000Z", now)).toBeNull();
  });

  it("counts down without rounding a short remainder up", () => {
    expect(dekiApprovalExpiryLabel("2026-06-25T12:00:30.000Z", now)).toBe("Expires in under a minute");
    expect(dekiApprovalExpiryLabel("2026-06-25T12:29:59.000Z", now)).toBe("Expires in 29 min");
  });

  it("falls back to the session wording for an unreadable timestamp", () => {
    expect(dekiApprovalExpiryLabel("not a date", now)).toBe("Expires with this app session");
  });
});

describe("parseDekiDataCommand", () => {
  it("reads the runtime command label", () => {
    expect(parseDekiDataCommand("deki data patch lorebook-entries/entry-koi")).toEqual({
      action: "patch",
      collection: "lorebook-entries",
      id: "entry-koi",
    });
    expect(parseDekiDataCommand("something else").action).toBeNull();
  });
});
