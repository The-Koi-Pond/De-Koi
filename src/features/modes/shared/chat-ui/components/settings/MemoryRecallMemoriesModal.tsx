import {
  AlertTriangle,
  Check,
  Download,
  Edit3,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Modal } from "../../../../../../shared/components/ui/Modal";
import { showConfirmDialog } from "../../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../../shared/lib/utils";
import type { ChatMemoryChunk, ChatMemoryKind } from "../../../../../../engine/contracts/types/chat";
import type { CanonicalMemoryRecord } from "../../../../../../engine/contracts/types/memory";
import {
  useChatMemories,
  useClearChatMemories,
  useCorrectChatMemory,
  useExportChatMemories,
  useImportChatMemories,
  useInheritedCharacterMemories,
  usePinChatMemory,
  useRefreshChatMemories,
  useRestoreChatMemory,
  useSoftDeleteChatMemory,
  useUpdateChatMemory,
} from "../../../../../catalog/chats/index";
import { useUIStore } from "../../../../../../shared/stores/ui.store";

export function formatMemoryDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export type MemoryStatusFilter = "all" | "active" | "deleted" | "wrong";
export type MemoryTypeFilter = "all" | ChatMemoryKind;
export type MemoryScopeFilter = "all" | "current" | "imported" | "targeted";
export type DisplayMemoryOwner =
  | { kind: "local"; label: "Local to this chat" | "Local to this scene" }
  | { kind: "character"; characterId: string; label: string };
export type DisplayMemory = ChatMemoryChunk & {
  owner: DisplayMemoryOwner;
  readOnly: boolean;
  canonicalMemory?: CanonicalMemoryRecord;
};

export function displayLocalMemory(memory: ChatMemoryChunk, _chatId: string): DisplayMemory {
  return {
    ...memory,
    owner: {
      kind: "local",
      label: memory.scopeType === "scene" ? "Local to this scene" : "Local to this chat",
    },
    readOnly: false,
  };
}

export function displayInheritedMemory(
  memory: CanonicalMemoryRecord,
  character: { id: string; name: string },
  chatId: string,
): DisplayMemory {
  const timestamp = memory.provenance.timestamp || memory.updatedAt || memory.createdAt;
  return {
    id: memory.id,
    chatId,
    content: memory.content,
    memoryKind: memory.kind === "episode" ? "character" : memory.kind === "summary" ? "summary" : "character",
    scopeType: "character",
    scopeId: character.id,
    status: memory.status === "deleted" ? "deleted" : memory.status === "active" || memory.status === "pinned" ? "active" : "wrong",
    pinned: memory.status === "pinned",
    confidence: memory.confidence,
    creationReason: "Inherited character memory",
    messageCount: Math.max(1, memory.provenance.messageIds.length),
    messageIds: [...memory.provenance.messageIds],
    firstMessageAt: timestamp,
    lastMessageAt: timestamp,
    createdAt: memory.createdAt,
    source: "canonical_character",
    sourceChatId: memory.provenance.sourceChatId ?? null,
    targetCharacterId: character.id,
    targetCharacterName: character.name,
    hasEmbedding: true,
    embeddingStatus: "vectorized",
    embeddingSource: "lexical",
    owner: {
      kind: "character",
      characterId: character.id,
      label: `Inherited from ${character.name}`,
    },
    readOnly: true,
    canonicalMemory: memory,
  };
}

const MEMORY_CONTENT_CLASS =
  "min-h-44 max-h-64 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs leading-relaxed text-[var(--foreground)] outline-none transition focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/25";

function estimateMemoryTokens(memories: ChatMemoryChunk[]): number {
  const text = memories.map((memory) => memory.content).join("\n\n");
  return Math.ceil(text.length / 4);
}

export function memoryStatus(memory: ChatMemoryChunk): Exclude<MemoryStatusFilter, "all"> {
  if (memory.status === "deleted" || memory.deletedAt) return "deleted";
  if (memory.status === "wrong" || memory.correctedAt) return "wrong";
  return "active";
}

export function memoryType(memory: ChatMemoryChunk): Exclude<MemoryTypeFilter, "all"> {
  if (memory.memoryKind) return memory.memoryKind;
  if (memory.source === "correction" || memory.correctionOfMemoryId) return "correction";
  if (memory.source === "connected_command" || memory.commandMemoryKey) return "command";
  if (memory.sourceChatId && memory.sourceChatId !== memory.chatId) return "imported";
  if (!memory.messageIds?.length) return "manual";
  return "transcript";
}

export function memoryScope(memory: ChatMemoryChunk): Exclude<MemoryScopeFilter, "all"> {
  if (memory.target || memory.targetCharacterName || memory.targetCharacterId) return "targeted";
  if (memory.sourceChatId && memory.sourceChatId !== memory.chatId) return "imported";
  return "current";
}

function memoryEmbeddingLabel(memory: ChatMemoryChunk): string {
  const source = String(memory.embeddingSource ?? "").toLowerCase();
  if (memoryStatus(memory) !== "active") return "Index inactive";
  if (source === "provider") return memory.embeddingModel ? `Semantic: ${memory.embeddingModel}` : "Semantic";
  if (source === "lexical") return "Lexical";
  if (!memory.hasEmbedding && (memory.embeddingStatus === "missing" || memory.embeddingStatus === "unavailable")) return "No index";
  if (!memory.hasEmbedding) return "Pending index";
  return "Indexed";
}

function memoryEmbeddingTitle(memory: ChatMemoryChunk): string {
  const source = String(memory.embeddingSource ?? "").toLowerCase();
  if (memoryStatus(memory) !== "active") return "Inactive memories are not indexed for retrieval.";
  if (source === "provider") {
    return memory.embeddingConnectionId
      ? `Semantic embeddings from connection ${memory.embeddingConnectionId}`
      : "Semantic embeddings from the configured embedding connection";
  }
  if (source === "lexical") return "Local lexical fallback vector.";
  return memoryEmbeddingLabel(memory);
}

function memoryEmbeddingSummary(memories: ChatMemoryChunk[]): string {
  const active = memories.filter((memory) => memoryStatus(memory) === "active");
  const providerCount = active.filter((memory) => String(memory.embeddingSource ?? "").toLowerCase() === "provider").length;
  const lexicalCount = active.filter((memory) => String(memory.embeddingSource ?? "").toLowerCase() === "lexical").length;
  const inactiveCount = memories.length - active.length;
  const parts = [
    providerCount > 0 ? `${providerCount} semantic` : "",
    lexicalCount > 0 ? `${lexicalCount} lexical` : "",
    inactiveCount > 0 ? `${inactiveCount} inactive` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

function memorySearchText(memory: ChatMemoryChunk): string {
  const owner = (memory as Partial<DisplayMemory>).owner;
  return [
    memory.content,
    memory.source,
    memory.sourceChatId,
    memory.commandMemoryKey,
    memory.target,
    memory.targetCharacterName,
    memory.creationReason,
    memory.memoryKind,
    memory.scopeType,
    memory.scopeId,
    memory.legacySourceLane,
    memory.legacySourceId,
    memory.id,
    owner?.label,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function filterMemories<T extends ChatMemoryChunk>(
  memories: T[],
  filters: { query: string; status: MemoryStatusFilter; type: MemoryTypeFilter; scope: MemoryScopeFilter },
): T[] {
  const query = filters.query.trim().toLowerCase();
  return memories.filter((memory) => {
    if (filters.status !== "all" && memoryStatus(memory) !== filters.status) return false;
    if (filters.type !== "all" && memoryType(memory) !== filters.type) return false;
    if (filters.scope !== "all" && memoryScope(memory) !== filters.scope) return false;
    if (query && !memorySearchText(memory).includes(query)) return false;
    return true;
  });
}

function statusClass(status: ReturnType<typeof memoryStatus>): string {
  if (status === "active") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "wrong") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-[var(--destructive)]/10 text-[var(--destructive)]";
}

function DetailRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b border-[var(--border)]/70 py-1.5 text-[0.6875rem] last:border-b-0">
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-[var(--foreground)]" title={title ?? value}>
        {value}
      </dd>
    </div>
  );
}

function iconButtonClass(active = false, destructive = false) {
  return cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-45",
    active && "border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300",
    destructive && "hover:border-[var(--destructive)]/40 hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]",
  );
}

export function MemoryRecallMemoriesModal({ chatId, open, onClose }: { chatId: string; open: boolean; onClose: () => void }) {
  const memoriesQuery = useChatMemories(chatId, open);
  const inheritedMemoriesQuery = useInheritedCharacterMemories(chatId, open);
  const openCharacterDetail = useUIStore((state) => state.openCharacterDetail);
  const softDeleteMemory = useSoftDeleteChatMemory(chatId);
  const restoreMemory = useRestoreChatMemory(chatId);
  const updateMemory = useUpdateChatMemory(chatId);
  const pinMemory = usePinChatMemory(chatId);
  const correctMemory = useCorrectChatMemory(chatId);
  const clearMemories = useClearChatMemories(chatId);
  const refreshMemories = useRefreshChatMemories(chatId);
  const exportMemories = useExportChatMemories(chatId);
  const importMemories = useImportChatMemories(chatId);
  const importInputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const editId = useId();
  const replacementId = useId();

  const localMemories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);
  const memories = useMemo<DisplayMemory[]>(
    () => [
      ...localMemories.map((memory) => displayLocalMemory(memory, chatId)),
      ...(inheritedMemoriesQuery.data ?? []).map(({ memory, characterId, characterName }) =>
        displayInheritedMemory(memory, { id: characterId, name: characterName }, chatId),
      ),
    ],
    [chatId, inheritedMemoriesQuery.data, localMemories],
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MemoryStatusFilter>("active");
  const [type, setType] = useState<MemoryTypeFilter>("all");
  const [scope, setScope] = useState<MemoryScopeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ memoryId: string | null; content: string }>({ memoryId: null, content: "" });
  const [replacementDraft, setReplacementDraft] = useState("");

  const filtered = useMemo(() => filterMemories(memories, { query, status, type, scope }), [memories, query, status, type, scope]);
  const selected = useMemo(
    () => filtered.find((memory) => memory.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );
  const totalTokens = useMemo(() => estimateMemoryTokens(memories), [memories]);
  const embeddingSummary = useMemo(() => memoryEmbeddingSummary(memories), [memories]);
  const busy =
    softDeleteMemory.isPending ||
    restoreMemory.isPending ||
    updateMemory.isPending ||
    pinMemory.isPending ||
    correctMemory.isPending ||
    refreshMemories.isPending ||
    importMemories.isPending;

  useEffect(() => {
    if (!selected && filtered.length > 0) setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selected]);

  useEffect(() => {
    setDraft({ memoryId: selected?.id ?? null, content: selected?.content ?? "" });
    setReplacementDraft("");
  }, [selected?.id, selected?.content]);

  const handleExport = async () => {
    if (localMemories.length === 0) {
      toast.error("There are no recall memories to export yet.");
      return;
    }
    try {
      await exportMemories.mutateAsync();
      toast.success("Memory Recall exported.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export Memory Recall.");
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await importMemories.mutateAsync(file);
      if (result.imported > 0) toast.success(`Imported ${result.imported} memor${result.imported === 1 ? "y" : "ies"}.`);
      else toast.info("No new recall memories were imported.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import Memory Recall.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!selected || selected.readOnly) return;
    const selectedStatusAtSave = memoryStatus(selected);
    const currentMemory = memories.find((memory) => memory.id === selected.id);
    if (selectedStatusAtSave !== "active" || !currentMemory || draft.memoryId !== currentMemory.id || memoryStatus(currentMemory) !== "active") {
      toast.error("Only active memories can be edited.");
      return;
    }
    const content = draft.content.trim();
    if (!content) {
      toast.error("Memory content cannot be empty.");
      return;
    }
    try {
      await updateMemory.mutateAsync({ memoryId: currentMemory.id, content });
      toast.success("Memory updated and re-indexed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update memory.");
    }
  };

  const handleSoftDelete = async () => {
    if (!selected || selected.readOnly) return;
    const ok = await showConfirmDialog({
      title: "Delete Memory",
      message: "Move this memory out of recall? It can be restored later.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await softDeleteMemory.mutateAsync(selected.id);
      toast.success("Memory removed from recall.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete memory.");
    }
  };

  const handleRestore = async () => {
    if (!selected || selected.readOnly) return;
    try {
      await restoreMemory.mutateAsync(selected.id);
      toast.success("Memory restored and re-indexed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore memory.");
    }
  };

  const handlePin = async () => {
    if (!selected || selected.readOnly) return;
    try {
      await pinMemory.mutateAsync({ memoryId: selected.id, pinned: !selected.pinned });
      toast.success(selected.pinned ? "Memory unpinned." : "Memory pinned for recall.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update pin.");
    }
  };

  const handleCorrect = async () => {
    if (!selected || selected.readOnly) return;
    try {
      await correctMemory.mutateAsync({ memoryId: selected.id, replacementContent: replacementDraft.trim() || undefined });
      toast.success(replacementDraft.trim() ? "Correction saved and indexed." : "Memory marked wrong.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to correct memory.");
    }
  };

  const handleClear = async () => {
    if (localMemories.length === 0) return;
    const ok = await showConfirmDialog({
      title: "Clear Memories",
      message: "Remove all recall memories for this chat? This cannot be restored from the console.",
      confirmLabel: "Clear",
      tone: "destructive",
    });
    if (ok) clearMemories.mutate();
  };

  const selectedStatus = selected ? memoryStatus(selected) : "active";
  const selectedCharacterId = selected?.owner.kind === "character" ? selected.owner.characterId : null;
  const draftContent = draft.memoryId === selected?.id ? draft.content : selected?.content ?? "";

  return (
    <Modal open={open} onClose={onClose} title="Memory Console" width="max-w-6xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--secondary)]/70 px-3 py-2 ring-1 ring-[var(--border)]">
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]" aria-live="polite">
            <span className="font-semibold text-[var(--foreground)]">{memories.length}</span> memories
            {memories.length > 0 && <span className="tabular-nums"> / ~{totalTokens.toLocaleString()} tokens</span>}
            {embeddingSummary && <span> / {embeddingSummary}</span>}
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json,.marinara"
              className="hidden"
              onChange={(event) => void handleImportFile(event.currentTarget.files?.[0])}
            />
            <button type="button" onClick={() => void handleExport()} disabled={localMemories.length === 0 || exportMemories.isPending} className={iconButtonClass()} title="Export local memories" aria-label="Export local memories">
              <Upload size="0.875rem" />
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()} disabled={importMemories.isPending} className={iconButtonClass()} title="Import memories" aria-label="Import memories">
              {importMemories.isPending ? <Loader2 size="0.875rem" className="animate-spin" /> : <Download size="0.875rem" />}
            </button>
            <button type="button" onClick={() => refreshMemories.mutate()} disabled={memoriesQuery.isFetching || refreshMemories.isPending || importMemories.isPending} className={iconButtonClass()} title="Rebuild memories" aria-label="Rebuild memories">
              <RefreshCw size="0.875rem" className={cn((memoriesQuery.isFetching || refreshMemories.isPending) && "animate-spin")} />
            </button>
            <button type="button" onClick={handleClear} disabled={localMemories.length === 0 || clearMemories.isPending} className={iconButtonClass(false, true)} title="Clear local memories" aria-label="Clear local memories">
              <Trash2 size="0.875rem" />
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.35fr)]">
          <section className="min-h-[28rem] rounded-md border border-[var(--border)] bg-[var(--card)]" aria-label="Memory list">
            <div className="border-b border-[var(--border)] p-3">
              <label htmlFor={searchId} className="sr-only">Search memories</label>
              <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
                <Search size="0.875rem" className="text-[var(--muted-foreground)]" />
                <input
                  id={searchId}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search content, source, target"
                  className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <label className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Scope
                  <select value={scope} onChange={(event) => setScope(event.target.value as MemoryScopeFilter)} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)]">
                    <option value="all">All</option>
                    <option value="current">Current</option>
                    <option value="imported">Imported</option>
                    <option value="targeted">Targeted</option>
                  </select>
                </label>
                <label className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Type
                  <select value={type} onChange={(event) => setType(event.target.value as MemoryTypeFilter)} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)]">
                    <option value="all">All</option>
                    <option value="transcript">Transcript</option>
                    <option value="manual">Manual</option>
                    <option value="imported">Imported</option>
                    <option value="command">Command</option>
                    <option value="character">Character</option>
                    <option value="scene_summary">Scene</option>
                    <option value="summary">Summary</option>
                    <option value="correction">Correction</option>
                  </select>
                </label>
                <label className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Status
                  <select value={status} onChange={(event) => setStatus(event.target.value as MemoryStatusFilter)} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)]">
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="deleted">Deleted</option>
                    <option value="wrong">Wrong</option>
                  </select>
                </label>
              </div>
            </div>

            {(memoriesQuery.isLoading || inheritedMemoriesQuery.isLoading) && (
              <div className="flex min-h-80 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Loader2 size="1rem" className="animate-spin" /> Loading memories...
              </div>
            )}
            {(memoriesQuery.error || inheritedMemoriesQuery.error) && (
              <div className="m-3 rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25" role="alert">
                Failed to load memories.
              </div>
            )}
            {!memoriesQuery.isLoading && !memoriesQuery.error && memories.length === 0 && (
              <div className="flex min-h-80 items-center justify-center px-8 text-center text-xs text-[var(--muted-foreground)]">
                No recall memories have been created for this chat yet.
              </div>
            )}
            {!memoriesQuery.isLoading && !memoriesQuery.error && memories.length > 0 && filtered.length === 0 && (
              <div className="flex min-h-80 items-center justify-center px-8 text-center text-xs text-[var(--muted-foreground)]">
                No memories match these filters.
              </div>
            )}
            {filtered.length > 0 && (
              <div className="max-h-[33rem] overflow-y-auto p-2" role="listbox" aria-label="Filtered memories">
                {filtered.map((memory) => {
                  const itemStatus = memoryStatus(memory);
                  const selectedItem = selected?.id === memory.id;
                  return (
                    <button
                      key={memory.id}
                      type="button"
                      role="option"
                      aria-selected={selectedItem}
                      onClick={() => setSelectedId(memory.id)}
                      className={cn(
                        "mb-1 w-full rounded-md border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/30",
                        selectedItem ? "border-[var(--ring)] bg-[var(--accent)]" : "border-transparent hover:border-[var(--border)] hover:bg-[var(--secondary)]/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {memory.pinned && <Pin size="0.75rem" className="text-amber-500" aria-label="Pinned" />}
                        <span className={cn("rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase", statusClass(itemStatus))}>{itemStatus}</span>
                        <span className="text-[0.625rem] uppercase tracking-wide text-[var(--muted-foreground)]">{memoryType(memory)}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-snug text-[var(--foreground)]">{memory.content}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                        <span>{memory.owner.label}</span>
                        <span>{memory.messageCount || 1} msg</span>
                        <span title={memoryEmbeddingTitle(memory)}>{memoryEmbeddingLabel(memory)}</span>
                        <span>{formatMemoryDate(memory.lastMessageAt || memory.createdAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-h-[28rem] rounded-md border border-[var(--border)] bg-[var(--card)]" aria-label="Memory detail">
            {!selected ? (
              <div className="flex h-full min-h-80 items-center justify-center text-xs text-[var(--muted-foreground)]">Select a memory.</div>
            ) : (
              <div className="space-y-3 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] pb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase", statusClass(selectedStatus))}>{selectedStatus}</span>
                      <span className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">{memoryType(selected)}</span>
                      <span title={memoryEmbeddingTitle(selected)} className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--muted-foreground)]">{memoryEmbeddingLabel(selected)}</span>
                    </div>
                    <div className="mt-1 truncate text-[0.6875rem] text-[var(--muted-foreground)]" title={selected.id}>{selected.id}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {selected.readOnly && selectedCharacterId ? (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          openCharacterDetail(selectedCharacterId, "memories");
                        }}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-[0.6875rem] font-medium hover:bg-[var(--accent)]"
                      >
                        Open character memories
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={handlePin} disabled={busy || selectedStatus !== "active"} className={iconButtonClass(!!selected.pinned)} title={selected.pinned ? "Unpin memory" : "Pin memory"} aria-label={selected.pinned ? "Unpin memory" : "Pin memory"}>
                          {selected.pinned ? <PinOff size="0.875rem" /> : <Pin size="0.875rem" />}
                        </button>
                        {selectedStatus === "active" ? (
                          <button type="button" onClick={() => void handleSoftDelete()} disabled={busy} className={iconButtonClass(false, true)} title="Delete memory" aria-label="Delete memory">
                            <Trash2 size="0.875rem" />
                          </button>
                        ) : (
                          <button type="button" onClick={() => void handleRestore()} disabled={busy} className={iconButtonClass()} title="Restore memory" aria-label="Restore memory">
                            <RotateCcw size="0.875rem" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <dl className="rounded-md bg-[var(--secondary)]/40 px-3 py-1 ring-1 ring-[var(--border)]/70">
                  <DetailRow label="Created" value={formatMemoryDate(selected.createdAt)} />
                  <DetailRow label="Owner" value={selected.owner.label} />
                  <DetailRow label="Range" value={`${formatMemoryDate(selected.firstMessageAt)} - ${formatMemoryDate(selected.lastMessageAt)}`} />
                  <DetailRow label="Provenance" value={selected.sourceChatId && selected.sourceChatId !== selected.chatId ? `Imported from ${selected.sourceChatId}` : selected.source || "Current transcript"} />
                  <DetailRow label="Reason" value={selected.creationReason || (memoryType(selected) === "correction" ? "User correction" : "Automatic recall chunk")} />
                  <DetailRow label="Confidence" value={typeof selected.confidence === "number" ? `${Math.round(selected.confidence * 100)}%` : "Not recorded"} />
                  <DetailRow label="Usage" value={selected.lastRecalledAt || selected.lastUsedAt ? `${selected.recallCount ?? 1} recalls, last ${formatMemoryDate(selected.lastRecalledAt || selected.lastUsedAt)}` : "Not recorded"} />
                  <DetailRow label="Target" value={selected.targetCharacterName || selected.target || selected.targetCharacterId || "None"} />
                  <DetailRow label="Edited" value={selected.userEdited ? "User edited" : "Original"} />
                </dl>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={editId} className="text-[0.6875rem] font-semibold text-[var(--foreground)]">Memory Text</label>
                    {!selected.readOnly && <button type="button" onClick={() => void handleSave()} disabled={busy || selectedStatus !== "active" || draft.memoryId !== selected.id || draftContent.trim() === selected.content.trim()} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--foreground)] transition hover:bg-[var(--accent)] disabled:pointer-events-none disabled:opacity-45">
                      {updateMemory.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Check size="0.75rem" />}
                      Save
                    </button>}
                  </div>
                  <textarea id={editId} value={draftContent} onChange={(event) => {
                    if (!selected.readOnly && selectedStatus === "active" && selected) setDraft({ memoryId: selected.id, content: event.target.value });
                  }} disabled={selected.readOnly || selectedStatus !== "active"} className={MEMORY_CONTENT_CLASS} />
                </div>

                {!selected.readOnly && <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-[0.6875rem] font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle size="0.875rem" /> Correction
                  </div>
                  <label htmlFor={replacementId} className="sr-only">Replacement memory</label>
                  <textarea
                    id={replacementId}
                    value={replacementDraft}
                    onChange={(event) => setReplacementDraft(event.target.value)}
                    placeholder="Optional replacement memory"
                    disabled={selectedStatus !== "active"}
                    className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/25 disabled:opacity-60"
                  />
                  <div className="mt-2 flex justify-end">
                    <button type="button" onClick={() => void handleCorrect()} disabled={busy || selectedStatus !== "active"} className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 px-2 py-1 text-[0.6875rem] font-medium text-amber-700 transition hover:bg-amber-400/10 disabled:pointer-events-none disabled:opacity-45 dark:text-amber-300">
                      {correctMemory.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : replacementDraft.trim() ? <Edit3 size="0.75rem" /> : <X size="0.75rem" />}
                      {replacementDraft.trim() ? "Correct" : "Mark wrong"}
                    </button>
                  </div>
                </div>}
              </div>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
