import { describe, expect, it } from "vitest";

import { ACTION_VERB_RULES, buildActionConfirmDialog, confirmAction, getActionVerb } from "./action-contracts";
import { resolveActiveDialog } from "./app-dialogs";
import { useDialogStore } from "../stores/dialog.store";

describe("action contracts", () => {
  it("defines the Delete vs Remove grammar used by consistency audits", () => {
    expect(ACTION_VERB_RULES.delete).toContain("permanent");
    expect(ACTION_VERB_RULES.remove).toContain("unlink");
    expect(getActionVerb("permanent")).toBe("Delete");
    expect(getActionVerb("unlink")).toBe("Remove");
    expect(getActionVerb("choice")).toBe("Import");
  });

  it("builds destructive Delete confirmation copy with the shared app dialog shape", () => {
    expect(
      buildActionConfirmDialog({
        action: "delete",
        resource: "checkpoint",
        name: "Before the boss",
      }),
    ).toEqual({
      title: "Delete Checkpoint",
      message: 'Delete "Before the boss"? This cannot be undone.',
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "destructive",
    });
  });

  it("builds reversible Remove confirmation copy without claiming saved data loss", () => {
    expect(
      buildActionConfirmDialog({
        action: "remove",
        resource: "widget",
        name: "Resolve",
        context: "from the next session",
      }),
    ).toEqual({
      title: "Remove Widget",
      message: 'Remove "Resolve" from the next session?',
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      tone: "default",
    });
  });

  it("routes confirmations through the shared app dialog store", async () => {
    const promise = confirmAction({ action: "delete", resource: "backup", name: "Monday" });
    expect(useDialogStore.getState().dialog).toMatchObject({
      kind: "confirm",
      title: "Delete Backup",
      confirmLabel: "Delete",
      tone: "destructive",
    });

    resolveActiveDialog(true);
    await expect(promise).resolves.toBe(true);
  });
});
