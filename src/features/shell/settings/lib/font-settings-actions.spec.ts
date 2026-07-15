import { describe, expect, it } from "vitest";
import { fontManagementMode } from "./font-settings-actions";

describe("font settings actions", () => {
  it("uses the folder action only for embedded desktop clients", () => {
    expect(fontManagementMode(true)).toBe("folder");
    expect(fontManagementMode(false)).toBe("upload");
  });
});
