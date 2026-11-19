import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import type { SpriteCleanupRestoreResult } from "./use-sprites";

/**
 * Restores a sprite restore point (a cleanup's or an editor save's). When a sprite was saved, edited or deleted
 * after the restore point was made, the server restores nothing and names those sprites; this asks before undoing
 * anyway, since that also throws away the later change. Null when the user keeps the later change.
 */
export async function restoreSpritePointAskingFirst(
  restore: (overwriteChanged: boolean) => Promise<SpriteCleanupRestoreResult>,
  displayExpression: (expression: string) => string,
): Promise<SpriteCleanupRestoreResult | null> {
  const result = await restore(false);
  const changed = result.changedSince ?? [];
  if (changed.length === 0) return result;
  const names = changed.map(displayExpression).join(", ");
  const confirmed = await showConfirmDialog({
    title: "Undo Anyway?",
    message: `${names} changed after this restore point was made. Undoing puts the older ${changed.length === 1 ? "picture" : "pictures"} back and loses that later change.`,
    confirmLabel: "Undo Anyway",
  });
  return confirmed ? restore(true) : null;
}
