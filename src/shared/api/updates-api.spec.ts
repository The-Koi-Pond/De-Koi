import { describe, expect, it, vi } from "vitest";

import { openUpdateRelease, type UpdateCheckResponse } from "./updates-api";

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
