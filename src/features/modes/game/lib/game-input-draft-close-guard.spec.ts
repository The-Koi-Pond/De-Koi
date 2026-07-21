import { describe, expect, it, vi } from "vitest";
import { createGameInputDraftCloseGuardInstaller } from "./game-input-draft-close-guard";

describe("Game input draft close guard", () => {
  it("installs one lifetime guard scoped only to app close", () => {
    const register = vi.fn();
    const drafts = { hasUnsavedMemoryWork: vi.fn(() => true) };
    const ensureInstalled = createGameInputDraftCloseGuardInstaller(drafts, register);

    ensureInstalled();
    ensureInstalled();

    expect(register).toHaveBeenCalledTimes(1);
    const guard = register.mock.calls[0]?.[0];
    expect(guard).toMatchObject({
      label: "Game turn attachments",
      purposes: ["app-close"],
    });
    expect(guard?.hasPendingWork()).toBe(true);
  });
});
