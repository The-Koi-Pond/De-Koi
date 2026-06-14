import { useMemo, useState } from "react";
import { BookOpen, Check, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { Lorebook, LorebookScope, LorebookScopeMode } from "../../../../../engine/contracts/types/lorebook";
import { Modal } from "../../../../../shared/components/ui/Modal";
import { normalizeChatCharacterIds } from "../../../../../shared/lib/chat-display";
import { cn } from "../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useChatSummaries, type ChatListItem, type ChatMode } from "../../../chats/index";
import { useLorebooks, useUpdateLorebook } from "../../hooks/use-lorebooks";

type LorebookOwnerType = "character" | "persona";

type AssignmentDraft = {
  lorebookId: string | null;
  mode: LorebookScopeMode;
  chatIds: string[];
  search: string;
};

type OwnerAssignmentPatch = { characterId: null; characterIds: string[] } | { personaId: null; personaIds: string[] };

type LorebookAssignmentSectionProps = {
  ownerType: LorebookOwnerType;
  ownerId: string | null;
  ownerName: string;
};

const DEFAULT_LOREBOOK_SCOPE: LorebookScope = { mode: "all", chatIds: [] };

const MODE_LABELS: Record<ChatMode, string> = {
  conversation: "Conversation",
  roleplay: "Roleplay",
  game: "Game",
};

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)));
}

function normalizeLorebookScope(value: unknown): LorebookScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_LOREBOOK_SCOPE;
  const scope = value as Partial<LorebookScope>;
  const mode: LorebookScopeMode =
    scope.mode === "disabled" || scope.mode === "specific" || scope.mode === "all" ? scope.mode : "all";
  return {
    mode,
    chatIds: mode === "specific" ? uniqueIds(Array.isArray(scope.chatIds) ? scope.chatIds : []) : [],
  };
}

function getOwnerIds(lorebook: Lorebook, ownerType: LorebookOwnerType): string[] {
  return ownerType === "character"
    ? uniqueIds([lorebook.characterId, ...(Array.isArray(lorebook.characterIds) ? lorebook.characterIds : [])])
    : uniqueIds([lorebook.personaId, ...(Array.isArray(lorebook.personaIds) ? lorebook.personaIds : [])]);
}

function isLorebookAssignedToOwner(lorebook: Lorebook, ownerType: LorebookOwnerType, ownerId: string | null): boolean {
  return ownerId ? getOwnerIds(lorebook, ownerType).includes(ownerId) : false;
}

function ownerAssignmentPatch(ownerType: LorebookOwnerType, ownerIds: string[]): OwnerAssignmentPatch {
  return ownerType === "character"
    ? { characterId: null, characterIds: uniqueIds(ownerIds) }
    : { personaId: null, personaIds: uniqueIds(ownerIds) };
}

function getScopeLabel(scope: LorebookScope, chats: ChatListItem[]): string {
  if (scope.mode === "disabled") return "Disabled";
  if (scope.mode === "specific") {
    const eligibleIds = new Set(chats.map((chat) => chat.id));
    const count = scope.chatIds.filter((id) => eligibleIds.has(id)).length;
    return count === 1 ? "1 chat" : `${count} chats`;
  }
  return "All chats";
}

function matchesOwnerChat(chat: ChatListItem, ownerType: LorebookOwnerType, ownerId: string | null): boolean {
  if (!ownerId) return false;
  if (ownerType === "character") return normalizeChatCharacterIds(chat.characterIds).includes(ownerId);
  return chat.personaId === ownerId;
}

function chatModeLabel(mode: ChatMode): string {
  return MODE_LABELS[mode] ?? mode;
}

export function LorebookAssignmentSection({ ownerType, ownerId, ownerName }: LorebookAssignmentSectionProps) {
  const openModal = useUIStore((state) => state.openModal);
  const openLorebookDetail = useUIStore((state) => state.openLorebookDetail);
  const { data: lorebooks = [], isLoading } = useLorebooks();
  const { data: chats = [] } = useChatSummaries();
  const updateLorebook = useUpdateLorebook();
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);

  const assignableLorebooks = useMemo(() => lorebooks.filter((lorebook) => !lorebook.isGlobal), [lorebooks]);

  const eligibleChats = useMemo(
    () =>
      chats
        .filter((chat) => matchesOwnerChat(chat, ownerType, ownerId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [chats, ownerId, ownerType],
  );

  const assignedLorebooks = useMemo(
    () => assignableLorebooks.filter((lorebook) => isLorebookAssignedToOwner(lorebook, ownerType, ownerId)),
    [assignableLorebooks, ownerId, ownerType],
  );

  const filteredLorebooks = useMemo(() => {
    const query = draft?.search.trim().toLowerCase() ?? "";
    return assignableLorebooks.filter((lorebook) => {
      if (!query) return true;
      return `${lorebook.name} ${lorebook.description} ${lorebook.category}`.toLowerCase().includes(query);
    });
  }, [assignableLorebooks, draft?.search]);

  const selectedLorebook = draft?.lorebookId
    ? assignableLorebooks.find((lorebook) => lorebook.id === draft.lorebookId)
    : null;

  const openAssignment = (lorebook?: Lorebook) => {
    const scope = normalizeLorebookScope(lorebook?.scope);
    setDraft({
      lorebookId: lorebook?.id ?? null,
      mode: scope.mode,
      chatIds: scope.chatIds,
      search: "",
    });
  };

  const handleCreateLorebook = () => {
    if (!ownerId) return;
    openModal("create-lorebook", {
      defaultCategory: "character",
      defaultScope: DEFAULT_LOREBOOK_SCOPE,
      ...(ownerType === "character" ? { characterId: ownerId } : { personaId: ownerId }),
    });
  };

  const saveAssignment = async () => {
    if (!draft || !selectedLorebook || !ownerId) return;

    const nextScope: LorebookScope = {
      mode: draft.mode,
      chatIds: draft.mode === "specific" ? uniqueIds(draft.chatIds) : [],
    };
    const nextOwnerIds = uniqueIds([...getOwnerIds(selectedLorebook, ownerType), ownerId]);

    try {
      await updateLorebook.mutateAsync({
        id: selectedLorebook.id,
        scope: nextScope,
        ...ownerAssignmentPatch(ownerType, nextOwnerIds),
      });
      toast.success(`Assigned ${selectedLorebook.name}.`);
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign lorebook.");
    }
  };

  const unassignLorebook = async (lorebook: Lorebook) => {
    if (!ownerId) return;
    const nextOwnerIds = getOwnerIds(lorebook, ownerType).filter((id) => id !== ownerId);

    try {
      await updateLorebook.mutateAsync({
        id: lorebook.id,
        ...ownerAssignmentPatch(ownerType, nextOwnerIds),
      });
      toast.success(`Removed ${lorebook.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove lorebook.");
    }
  };

  const toggleDraftChat = (chatId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const currentIds = new Set(current.chatIds);
      if (currentIds.has(chatId)) {
        currentIds.delete(chatId);
      } else {
        currentIds.add(chatId);
      }
      return { ...current, chatIds: Array.from(currentIds) };
    });
  };

  const specificSelectionInvalid = draft?.mode === "specific" && draft.chatIds.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Assigned Lorebooks</h3>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Attach lorebooks to {ownerName || `this ${ownerType}`} and choose where they activate.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCreateLorebook}
            disabled={!ownerId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
          >
            <Plus size="0.75rem" />
            New
          </button>
          <button
            type="button"
            onClick={() => openAssignment()}
            disabled={!ownerId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)]/15 px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/25 disabled:opacity-50"
          >
            <BookOpen size="0.75rem" />
            Assign
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <div className="shimmer h-12 rounded-xl" />
          <div className="shimmer h-12 rounded-xl" />
        </div>
      ) : assignedLorebooks.length > 0 ? (
        <div className="space-y-2">
          {assignedLorebooks.map((lorebook) => {
            const scope = normalizeLorebookScope(lorebook.scope);
            return (
              <div
                key={lorebook.id}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5"
              >
                <BookOpen size="0.875rem" className="shrink-0 text-amber-400" />
                <button
                  type="button"
                  onClick={() => openLorebookDetail(lorebook.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-medium text-[var(--foreground)]">{lorebook.name}</span>
                  <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                    {getScopeLabel(scope, eligibleChats)} · {lorebook.category}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openAssignment(lorebook)}
                  className="rounded-lg px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  Scope
                </button>
                <button
                  type="button"
                  onClick={() => void unassignLorebook(lorebook)}
                  disabled={updateLorebook.isPending}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-50"
                  title="Remove lorebook"
                >
                  <Trash2 size="0.75rem" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
          No assigned lorebooks.
        </div>
      )}

      <Modal open={draft !== null} onClose={() => setDraft(null)} title="Assign Lorebook" width="max-w-3xl">
        {draft && (
          <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
            <div className="relative">
              <Search
                size="0.875rem"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <input
                value={draft.search}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, search: event.target.value } : current))
                }
                placeholder="Search lorebooks..."
                className="w-full rounded-lg bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
              <div className="min-h-0 space-y-2">
                {filteredLorebooks.length > 0 ? (
                  filteredLorebooks.map((lorebook) => {
                    const selected = draft.lorebookId === lorebook.id;
                    const assigned = isLorebookAssignedToOwner(lorebook, ownerType, ownerId);
                    return (
                      <button
                        type="button"
                        key={lorebook.id}
                        onClick={() => {
                          const scope = normalizeLorebookScope(lorebook.scope);
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  lorebookId: lorebook.id,
                                  mode: scope.mode,
                                  chatIds: scope.chatIds,
                                }
                              : current,
                          );
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                          selected
                            ? "border-[var(--primary)] bg-[var(--primary)]/10"
                            : "border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)]",
                        )}
                      >
                        <BookOpen size="0.875rem" className="shrink-0 text-amber-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{lorebook.name}</span>
                          <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                            {lorebook.category}
                            {assigned ? " · assigned" : ""}
                          </span>
                        </span>
                        {selected && <Check size="0.875rem" className="shrink-0 text-[var(--primary)]" />}
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--muted-foreground)]">
                    No matching owner-scoped lorebooks.
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-3">
                <div>
                  <p className="text-xs font-semibold text-[var(--foreground)]">Scope</p>
                  <p className="mt-0.5 text-[0.6875rem] text-[var(--muted-foreground)]">
                    {selectedLorebook ? selectedLorebook.name : "Select a lorebook"} for {ownerName || ownerType}.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--background)] p-1 ring-1 ring-[var(--border)]">
                  {(["all", "specific", "disabled"] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      onClick={() =>
                        setDraft((current) =>
                          current ? { ...current, mode, chatIds: mode === "specific" ? current.chatIds : [] } : current,
                        )
                      }
                      className={cn(
                        "rounded-md px-2 py-1.5 text-[0.6875rem] font-medium capitalize transition-colors",
                        draft.mode === mode
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                {draft.mode === "specific" && (
                  <div className="space-y-2">
                    <p className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Eligible chats</p>
                    {eligibleChats.length > 0 ? (
                      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {eligibleChats.map((chat) => {
                          const checked = draft.chatIds.includes(chat.id);
                          return (
                            <button
                              type="button"
                              key={chat.id}
                              onClick={() => toggleDraftChat(chat.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                                checked ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-[var(--accent)]",
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  checked
                                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "border-[var(--border)]",
                                )}
                              >
                                {checked && <Check size="0.6875rem" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{chat.name}</span>
                                <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                  {chatModeLabel(chat.mode)}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
                        No chats are linked to this {ownerType}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {specificSelectionInvalid && (
              <div className="rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
                Choose at least one chat or use a different scope.
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                <X size="0.75rem" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveAssignment()}
                disabled={!selectedLorebook || specificSelectionInvalid || updateLorebook.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {updateLorebook.isPending ? (
                  <Loader2 size="0.75rem" className="animate-spin" />
                ) : (
                  <Check size="0.75rem" />
                )}
                Save Assignment
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
