import { describe, expect, it, vi } from "vitest";

import { formatUpdateIdentity, openUpdateRelease, type UpdateCheckResponse } from "./updates-api";

const updateInfo = {
  releaseUrl: "https://github.com/The-Koi-Pond/De-Koi/releases/latest",
} as UpdateCheckResponse;

describe("openUpdateRelease", () => {
  it("opens the checked release URL without requiring a privileged server apply command", async () => {
    const opener = vi.fn().mockResolvedValue(undefined);

    await openUpdateRelease(updateInfo, opener);

    expect(opener).toHaveBeenCalledWith(updateInfo.releaseUrl);
  });
});

describe("formatUpdateIdentity", () => {
  it("reports both the version and a short source commit", () => {
    expect(formatUpdateIdentity("1.6.1", "f5094c3177d86101bc2fada97d35a6d76ad40b6e")).toBe("1.6.1 (f5094c31)");
  });

  it("keeps version reporting useful when a legacy build has no embedded commit", () => {
    expect(formatUpdateIdentity("1.6.1", null)).toBe("1.6.1 (commit unavailable)");
  });
});
