export interface SaveMomentSource {
  chatId: string;
  messageId: string;
  role: string;
  speakerName?: string | null;
  createdAt?: string | null;
  content: string;
}

export type SaveMomentMenuItemId = "copy-snippet" | "lore-draft" | "branch" | "clone-scene";

export interface SaveMomentMenuItem {
  id: SaveMomentMenuItemId;
  label: string;
}

export function buildSaveMomentExportText(source: SaveMomentSource): string {
  const lines = [
    "De-Koi Save Moment",
    `Chat: ${source.chatId}`,
    `Message: ${source.messageId}`,
    `Role: ${source.role}`,
  ];
  const speaker = source.speakerName?.trim();
  if (speaker) lines.push(`Speaker: ${speaker}`);
  if (source.createdAt) lines.push(`Created: ${source.createdAt}`);
  lines.push("", source.content);
  return lines.join("\n");
}

export function buildSaveMomentMenuItems({
  canBranch,
  canCloneScene,
  canDraftLore = false,
}: {
  canBranch: boolean;
  canCloneScene: boolean;
  canDraftLore?: boolean;
}): SaveMomentMenuItem[] {
  const items: SaveMomentMenuItem[] = [{ id: "copy-snippet", label: "Copy snippet" }];
  if (canDraftLore) items.push({ id: "lore-draft", label: "Draft lore entry" });
  if (canBranch) items.push({ id: "branch", label: "Branch from here" });
  if (canCloneScene) items.push({ id: "clone-scene", label: "Clone from here" });
  return items;
}
