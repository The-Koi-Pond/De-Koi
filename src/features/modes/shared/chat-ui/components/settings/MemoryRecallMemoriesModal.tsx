import { Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { Modal } from "../../../../../../shared/components/ui/Modal";
import { showConfirmDialog } from "../../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../../shared/lib/utils";
import type { ChatMemoryChunk } from "../../../../../../engine/contracts/types/chat";
import {
  useChatMemories,
  useClearChatMemories,
  useDeleteChatMemory,
  useExportChatMemories,
  useImportChatMemories,
  useRefreshChatMemories,
} from "../../../../../catalog/chats/index";

export function formatMemoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function estimateMemoryTokens(memories: ChatMemoryChunk[]): number {
  const text = memories.map((memory) => memory.content).join("\n\n");
  return Math.ceil(text.length / 4);
}

function memoryEmbeddingLabel(memory: ChatMemoryChunk): string {
  const source = String(memory.embeddingSource ?? "").toLowerCase();
  if (source === "provider") {
    return memory.embeddingModel ? `Semantic: ${memory.embeddingModel}` : "Semantic provider";
  }
  if (source === "lexical") return "Lexical fallback";
  if (!memory.hasEmbedding && memory.embeddingStatus === "unavailable") return "Embedding unavailable";
  if (!memory.hasEmbedding) return "Waiting for vector";
  return "Vectorized";
}

function memoryEmbeddingTitle(memory: ChatMemoryChunk): string {
  const source = String(memory.embeddingSource ?? "").toLowerCase();
  if (source === "provider") {
    return memory.embeddingConnectionId
      ? `Semantic embeddings from connection ${memory.embeddingConnectionId}`
      : "Semantic embeddings from the configured embedding connection";
  }
  if (source === "lexical") {
    return "Local lexical fallback is being used because no embedding-capable connection vectorized this memory.";
  }
  return memoryEmbeddingLabel(memory);
}

function memoryEmbeddingSummary(memories: ChatMemoryChunk[]): string {
  const providerCount = memories.filter(
    (memory) => String(memory.embeddingSource ?? "").toLowerCase() === "provider",
  ).length;
  const lexicalCount = memories.filter(
    (memory) => String(memory.embeddingSource ?? "").toLowerCase() === "lexical",
  ).length;
  const unavailableCount = memories.filter(
    (memory) => !memory.hasEmbedding && String(memory.embeddingStatus ?? "").toLowerCase() === "unavailable",
  ).length;
  const parts = [
    providerCount > 0 ? `${providerCount} semantic` : "",
    lexicalCount > 0 ? `${lexicalCount} lexical fallback` : "",
    unavailableCount > 0 ? `${unavailableCount} unavailable` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

const MEMORY_CONTENT_CLASS =
  "max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--secondary)]/50 px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--foreground)]";

export function MemoryRecallMemoriesModal({ chatId, open, onClose }: { chatId: string; open: boolean; onClose: () => void }) {
  const memoriesQuery = useChatMemories(chatId, open);
  const deleteMemory = useDeleteChatMemory(chatId);
  const clearMemories = useClearChatMemories(chatId);
  const refreshMemories = useRefreshChatMemories(chatId);
  const exportMemories = useExportChatMemories(chatId);
  const importMemories = useImportChatMemories(chatId);
  const importInputRef = useRef<HTMLInputElement>(null);
  const memories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);
  const totalTokens = useMemo(() => estimateMemoryTokens(memories), [memories]);
  const embeddingSummary = useMemo(() => memoryEmbeddingSummary(memories), [memories]);

  const handleExport = async () => {
    if (memories.length === 0) {
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
      if (result.imported > 0) {
        toast.success(`Imported ${result.imported} memor${result.imported === 1 ? "y" : "ies"}.`);
      } else {
        toast.info("No new recall memories were imported.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import Memory Recall.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleDelete = async (memory: ChatMemoryChunk) => {
    const ok = await showConfirmDialog({
      title: "Forget Memory",
      message: "Remove this recall memory from this chat?",
      confirmLabel: "Forget",
      tone: "destructive",
    });
    if (ok) deleteMemory.mutate(memory.id);
  };

  const handleClear = async () => {
    if (memories.length === 0) return;
    const ok = await showConfirmDialog({
      title: "Clear Memories",
      message: "Remove all recall memories for this chat? This does not delete chat messages.",
      confirmLabel: "Clear",
      tone: "destructive",
    });
    if (ok) clearMemories.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title="Memories for This Chat" width="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--secondary)]/70 px-3 py-2 ring-1 ring-[var(--border)]">
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">{memories.length}</span>{" "}
            {memories.length === 1 ? "memory chunk" : "memory chunks"}
            {memories.length > 0 && (
              <>
                {" "}
                · <span className="tabular-nums">~{totalTokens.toLocaleString()} tokens</span>
              </>
            )}
            {embeddingSummary && (
              <>
                {" "}
                · <span>{embeddingSummary}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json,.marinara"
              className="hidden"
              onChange={(event) => void handleImportFile(event.currentTarget.files?.[0])}
            />
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={memories.length === 0 || exportMemories.isPending}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
              title="Export memories"
            >
              <Download size="0.8125rem" />
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importMemories.isPending}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
              title="Import memories"
            >
              {importMemories.isPending ? (
                <Loader2 size="0.8125rem" className="animate-spin" />
              ) : (
                <Upload size="0.8125rem" />
              )}
            </button>
            <button
              type="button"
              onClick={() => refreshMemories.mutate()}
              disabled={memoriesQuery.isFetching || refreshMemories.isPending || importMemories.isPending}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
              title="Rebuild memories from current chat messages"
            >
              <RefreshCw
                size="0.8125rem"
                className={cn((memoriesQuery.isFetching || refreshMemories.isPending) && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={memories.length === 0 || clearMemories.isPending}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
              title="Clear all memories"
            >
              <Trash2 size="0.8125rem" />
            </button>
          </div>
        </div>

        {memoriesQuery.isLoading && (
          <div className="rounded-xl bg-[var(--secondary)]/60 px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            Loading memories...
          </div>
        )}

        {memoriesQuery.error && (
          <div className="rounded-xl bg-[var(--destructive)]/10 px-4 py-3 text-xs text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25">
            Failed to load memories.
          </div>
        )}

        {!memoriesQuery.isLoading && !memoriesQuery.error && memories.length === 0 && (
          <div className="rounded-xl bg-[var(--secondary)]/60 px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            No recall memories have been created for this chat yet. De-Koi creates them after generation in groups of
            5 messages. Configure an embedding model for semantic recall, or use the local lexical fallback.
          </div>
        )}

        {memories.length > 0 && (
          <div className="space-y-2">
            {memories.map((memory) => (
              <article key={memory.id} className="rounded-xl bg-[var(--card)] px-3 py-3 ring-1 ring-[var(--border)]">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[0.625rem] text-[var(--muted-foreground)]">
                    <div className="font-medium text-[var(--foreground)]">
                      {formatMemoryDate(memory.firstMessageAt)} - {formatMemoryDate(memory.lastMessageAt)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>{memory.messageCount} messages</span>
                      <span title={memoryEmbeddingTitle(memory)}>{memoryEmbeddingLabel(memory)}</span>
                      <span>Created {formatMemoryDate(memory.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(memory)}
                    disabled={deleteMemory.isPending}
                    className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
                    title="Forget this memory"
                  >
                    <Trash2 size="0.75rem" />
                  </button>
                </div>
                <pre className={MEMORY_CONTENT_CLASS}>{memory.content}</pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Advanced Parameters (per-chat generation overrides) ──
