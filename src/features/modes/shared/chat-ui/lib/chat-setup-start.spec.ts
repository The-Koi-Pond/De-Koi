import { describe, expect, it, vi } from "vitest";

import { runChatSetupStart } from "./chat-setup-start";

describe("runChatSetupStart", () => {
  it("returns a visible failure when metadata persistence rejects", async () => {
    const finish = vi.fn();

    await expect(
      runChatSetupStart({
        persistMetadata: vi.fn().mockRejectedValue(new Error("storage unavailable")),
        generateSchedules: null,
        finish,
      }),
    ).resolves.toEqual({ ok: false, message: "storage unavailable" });
    expect(finish).not.toHaveBeenCalled();
  });

  it("finishes exactly once after metadata and optional schedule work complete", async () => {
    const finish = vi.fn();
    const generateSchedules = vi.fn().mockResolvedValue(undefined);

    await expect(
      runChatSetupStart({
        persistMetadata: vi.fn().mockResolvedValue(undefined),
        generateSchedules,
        finish,
      }),
    ).resolves.toEqual({ ok: true });
    expect(generateSchedules).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
