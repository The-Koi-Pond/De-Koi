import { beforeEach, describe, expect, it, vi } from "vitest";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { restoreSpritePointAskingFirst } from "./restore-sprite-point";
import type { SpriteCleanupRestoreResult } from "./use-sprites";

vi.mock("../../../../shared/lib/app-dialogs", () => ({ showConfirmDialog: vi.fn() }));

const confirm = vi.mocked(showConfirmDialog);
const display = (expression: string) => expression.replace(/_/g, " ");

function result(overrides: Partial<SpriteCleanupRestoreResult>): SpriteCleanupRestoreResult {
  return { restored: 0, failed: [], changedSince: [], sprites: [], ...overrides };
}

describe("restoreSpritePointAskingFirst", () => {
  beforeEach(() => confirm.mockReset());

  it("restores without asking when nothing changed since the restore point", async () => {
    const restore = vi.fn(async () => result({ restored: 2 }));

    await expect(restoreSpritePointAskingFirst(restore, display)).resolves.toMatchObject({ restored: 2 });

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before undoing over a sprite saved since, and overwrites only when confirmed", async () => {
    const restore = vi.fn(async (overwrite: boolean) =>
      overwrite ? result({ restored: 1 }) : result({ changedSince: ["very_happy"] }),
    );
    confirm.mockResolvedValueOnce(true);

    await expect(restoreSpritePointAskingFirst(restore, display)).resolves.toMatchObject({ restored: 1 });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Undo Anyway?",
        message:
          "very happy changed after this restore point was made. Undoing puts the older picture back and loses that later change.",
        confirmLabel: "Undo Anyway",
      }),
    );
    expect(restore.mock.calls).toEqual([[false], [true]]);
  });

  it("keeps the later change when the user says no", async () => {
    const restore = vi.fn(async () => result({ changedSince: ["sad", "happy"] }));
    confirm.mockResolvedValueOnce(false);

    await expect(restoreSpritePointAskingFirst(restore, display)).resolves.toBeNull();

    expect(confirm.mock.calls[0]?.[0].message).toContain("older pictures back");
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("treats a server without the change check (no changedSince) as nothing changed", async () => {
    const restore = vi.fn(async () => ({ restored: 1, failed: [], sprites: [] }));

    await expect(restoreSpritePointAskingFirst(restore, display)).resolves.toMatchObject({ restored: 1 });
    expect(confirm).not.toHaveBeenCalled();
  });
});
