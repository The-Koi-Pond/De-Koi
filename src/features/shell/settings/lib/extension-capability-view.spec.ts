import { describe, expect, it } from "vitest";
import { extensionCapabilityView } from "./extension-capability-view";

describe("extension capability view", () => {
  it("marks implemented and unimplemented declarations truthfully", () => {
    const rows = extensionCapabilityView({
      source: "package",
      permissions: ["ui:styles", "prompt:read"],
    } as never);
    expect(rows).toEqual([
      expect.objectContaining({ permission: "ui:styles", status: "available" }),
      expect.objectContaining({ permission: "prompt:read", status: "unavailable" }),
    ]);
  });

  it("labels legacy helpers as unscoped", () => {
    expect(extensionCapabilityView({ source: "file" } as never)[0]?.status).toBe("legacy-unscoped");
  });
});
