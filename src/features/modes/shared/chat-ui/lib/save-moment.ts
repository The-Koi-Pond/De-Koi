import type { DaySummaryEntry, WeekSummaryEntry } from "../../../../../engine/contracts/types/chat";

export interface SaveMomentSource {
  chatId: string;
  messageId: string;
  role: string;
  speakerName?: string | null;
  createdAt?: string | null;
  content: string;
}

export type SaveMomentMenuItemId = "copy-snippet" | "chat-summary" | "lore-draft" | "branch" | "clone-scene";

export interface SaveMomentMenuItem {
  id: SaveMomentMenuItemId;
  label: string;
}

export interface SaveMomentSummaryDraft {
  source: SaveMomentSource;
  dateKey: string;
  detail: string;
}

export interface SaveMomentSummaryDrafts {
  daySummaries: Record<string, DaySummaryEntry>;
  weekSummaries: Record<string, WeekSummaryEntry>;
}

function formatSummaryDateKey(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function sourceDate(source: SaveMomentSource, fallbackDate: Date): Date {
  if (source.createdAt) {
    const parsed = new Date(source.createdAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallbackDate;
}

function compactSourceContent(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= 1200) return compact;
  return `${compact.slice(0, 1197).trimEnd()}...`;
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

export function buildSaveMomentSummaryDraft(
  source: SaveMomentSource,
  fallbackDate: Date = new Date(),
): SaveMomentSummaryDraft {
  const speaker = source.speakerName?.trim();
  const actor = speaker ? `${speaker} (${source.role})` : source.role;
  return {
    source,
    dateKey: formatSummaryDateKey(sourceDate(source, fallbackDate)),
    detail: `Save Moment from ${actor}. Source chat ${source.chatId}, message ${source.messageId}: ${compactSourceContent(source.content)}`,
  };
}

export function applySaveMomentSummaryDraft(
  current: SaveMomentSummaryDrafts,
  draft: SaveMomentSummaryDraft,
): SaveMomentSummaryDrafts {
  const existing = current.daySummaries[draft.dateKey] ?? { summary: "", keyDetails: [] };
  const keyDetails = existing.keyDetails.includes(draft.detail)
    ? [...existing.keyDetails]
    : [...existing.keyDetails, draft.detail];

  return {
    daySummaries: {
      ...current.daySummaries,
      [draft.dateKey]: {
        ...existing,
        keyDetails,
      },
    },
    weekSummaries: { ...current.weekSummaries },
  };
}

export function buildSaveMomentMenuItems({
  canCreateSummaryDraft,
  canBranch,
  canCloneScene,
  canDraftLore = false,
}: {
  canCreateSummaryDraft?: boolean;
  canBranch: boolean;
  canCloneScene: boolean;
  canDraftLore?: boolean;
}): SaveMomentMenuItem[] {
  const items: SaveMomentMenuItem[] = [{ id: "copy-snippet", label: "Copy snippet" }];
  if (canCreateSummaryDraft) items.push({ id: "chat-summary", label: "Chat summary draft" });
  if (canDraftLore) items.push({ id: "lore-draft", label: "Draft lore entry" });
  if (canBranch) items.push({ id: "branch", label: "Branch from here" });
  if (canCloneScene) items.push({ id: "clone-scene", label: "Clone from here" });
  return items;
}
