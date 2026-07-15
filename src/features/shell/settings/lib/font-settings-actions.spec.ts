import { describe, expect, it } from "vitest";
import { fontManagementMode } from "./font-settings-actions";

describe("font settings actions", () => {
  it("uses the folder action only for embedded desktop clients", () => {
    expect(fontManagementMode("supported")).toBe("folder");
    expect(fontManagementMode("unsupported")).toBe("upload");
    expect(fontManagementMode("error")).toBe("unavailable");
  });
});
