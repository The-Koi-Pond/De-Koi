import type { LorebookCategory, LorebookScope, LorebookScopeMode } from "../../../../engine/contracts/types/lorebook";

export type LorebookOwnerType = "character" | "persona";

type ChatEligibilityItem = {
  id: string;
};

export const DEFAULT_LOREBOOK_SCOPE: LorebookScope = { mode: "all", chatIds: [] };

export function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)));
}

export function normalizeLorebookScope(value: unknown): LorebookScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_LOREBOOK_SCOPE;
  const scope = value as Partial<LorebookScope>;
  const mode: LorebookScopeMode =
    scope.mode === "disabled" || scope.mode === "specific" || scope.mode === "all" ? scope.mode : "all";
  return {
    mode,
    chatIds: mode === "specific" ? uniqueIds(Array.isArray(scope.chatIds) ? scope.chatIds : []) : [],
  };
}

export function eligibleScopeChatIds(chatIds: string[], eligibleChats: ChatEligibilityItem[]): string[] {
  const eligibleIds = new Set(eligibleChats.map((chat) => chat.id));
  return uniqueIds(chatIds).filter((chatId) => eligibleIds.has(chatId));
}

export function ownerCreateDefaultCategory(ownerType: LorebookOwnerType): LorebookCategory {
  return ownerType === "character" ? "character" : "uncategorized";
}
