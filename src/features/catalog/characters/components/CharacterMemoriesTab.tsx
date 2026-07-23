import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  Copy,
  Download,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { CharacterMemoryPersistence } from "../../../../engine/contracts/types/character";
import type { CanonicalMemoryRecord, MemoryStatus } from "../../../../engine/contracts/types/memory";
import { triggerDownload } from "../../../../shared/api/download-payload";
import { showAlertDialog, showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { cn } from "../../../../shared/lib/utils";
import {
  useCharacterMemories,
  useCharacterMemorySourceChats,
  useChatMemoryRows,
  useCreateCharacterMemory,
  useImportCharacterMemories,
  useUpdateCharacterMemory,
} from "../hooks/use-character-memories";
import {
  characterMemoryStatusLabel,
  createCharacterMemoryExport,
  normalizeChatMemoriesForCharacter,
  normalizeCharacterMemoryImport,
} from "../lib/character-memory-model";

type MemoryFilter = "active" | "pinned" | "deleted" | "all";

type CharacterMemoriesTabProps = {
  characterId: string;
  characterName: string;
  memoryPersistence: CharacterMemoryPersistence;
  onMemoryPersistenceChange: (value: CharacterMemoryPersistence) => void;
};

function statusVisible(status: MemoryStatus, filter: MemoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "active" || status === "pinned";
  return status === filter;
}
function sourceLabel(memory: CanonicalMemoryRecord): string {
  const sourceChatId = memory.provenance.sourceChatId?.trim();
  return sourceChatId ? `Chat ${sourceChatId.slice(0, 8)}` : "Character record";
}

function safeFilename(value: string): string {
  return value.trim().replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "character";
}

export function CharacterMemoriesTab({
  characterId,
  characterName,
  memoryPersistence,
  onMemoryPersistenceChange,
}: CharacterMemoriesTabProps) {
  const memoriesQuery = useCharacterMemories(characterId);
  const createMemory = useCreateCharacterMemory(characterId);
  const updateMemory = useUpdateCharacterMemory(characterId);
  const importMemories = useImportCharacterMemories(characterId);
  const sourceChats = useCharacterMemorySourceChats(characterId);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MemoryFilter>("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [newMemoryOpen, setNewMemoryOpen] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const newMemoryComposerId = useId();
  const [copyOpen, setCopyOpen] = useState(false);
  const [sourceChatId, setSourceChatId] = useState<string | null>(null);
  const [selectedChatMemoryIds, setSelectedChatMemoryIds] = useState<Set<string>>(new Set());
  const sourceRows = useChatMemoryRows(copyOpen ? sourceChatId : null);

  useEffect(() => {
    setNewMemoryOpen(false);
    setNewMemoryContent("");
  }, [characterId]);

  const memories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (memoriesQuery.data ?? [])
      .filter((memory) => statusVisible(memory.status, filter))
      .filter((memory) => {
        if (!query) return true;
        return [
          memory.content,
          memory.title ?? "",
          memory.kind,
          memory.status,
          memory.provenance.sourceChatId ?? "",
          ...memory.tags,
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [filter, memoriesQuery.data, search]);

  const saveEdit = async (memoryId: string) => {
    const content = editingContent.trim();
    if (!content) return;
    await updateMemory.mutateAsync({ memoryId, patch: { content } });
    setEditingId(null);
    toast.success("Memory updated");
  };

  const saveNewMemory = async () => {
    const content = newMemoryContent.trim();
    if (!content) return;
    try {
      const result = await createMemory.mutateAsync(content);
      setNewMemoryContent("");
      setNewMemoryOpen(false);
      if (result.indexRefreshFailed) {
        toast.warning("Memory added, but its recall index could not be refreshed.");
      } else {
        toast.success("Memory added");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add memory.");
    }
  };

  const changeStatus = async (memory: CanonicalMemoryRecord, status: MemoryStatus) => {
    if (
      status === "deleted" &&
      !(await showConfirmDialog({
        title: "Delete memory",
        message: "Hide this memory from future recall? You can restore it later.",
        confirmLabel: "Delete memory",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await updateMemory.mutateAsync({ memoryId: memory.id, patch: { status } });
  };

  const exportMemories = () => {
    const envelope = createCharacterMemoryExport({
      character: { id: characterId, name: characterName },
      memories: memoriesQuery.data ?? [],
    });
    triggerDownload({
      blob: new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
      filename: `${safeFilename(characterName)}-memories.json`,
    });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const envelope = JSON.parse(await file.text()) as unknown;
      const inputs = normalizeCharacterMemoryImport(envelope, { characterId });
      if (inputs.length === 0) throw new Error("The file contains no importable memories.");
      await importMemories.mutateAsync(inputs);
      toast.success(`Imported ${inputs.length} ${inputs.length === 1 ? "memory" : "memories"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import memories.";
      toast.error(message);
      await showAlertDialog({
        title: "Memory import failed",
        message,
        tone: "destructive",
      });
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const copySelectedRows = async () => {
    const selected = (sourceRows.data ?? []).filter((row) => selectedChatMemoryIds.has(String(row.id ?? "")));
    if (selected.length === 0) return;
    if (
      !(await showConfirmDialog({
        title: `Copy ${selected.length} ${selected.length === 1 ? "memory" : "memories"}?`,
        message: `Selected chat memories will become durable memories for ${characterName}. The original chat memories stay unchanged.`,
        confirmLabel: "Copy memories",
      }))
    ) {
      return;
    }
    const inputs = normalizeChatMemoriesForCharacter(selected, { characterId });
    await importMemories.mutateAsync(inputs);
    setSelectedChatMemoryIds(new Set());
    setCopyOpen(false);
    toast.success(`Copied ${inputs.length} ${inputs.length === 1 ? "memory" : "memories"}`);
  };

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--primary)]/12 p-2 text-[var(--primary)]">
            <Brain size="1.25rem" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Character memory</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
              Choose whether {characterName} carries learned memories between Conversations and Roleplays.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {([
            ["character", "Across chats", "Recommended. This character remembers you in other chats and roleplays."],
            ["chat", "This chat only", "New automatic memories stay inside the chat where they happened."],
          ] as const).map(([value, label, description]) => (
            <label
              key={value}
              className={cn(
                "cursor-pointer rounded-xl border p-3 transition-colors",
                memoryPersistence === value
                  ? "border-[var(--primary)] bg-[var(--primary)]/8"
                  : "border-[var(--border)] hover:bg-[var(--accent)]",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="character-memory-persistence"
                  value={value}
                  checked={memoryPersistence === value}
                  onChange={() => onMemoryPersistenceChange(value)}
                  className="accent-[var(--primary)]"
                />
                {label}
              </span>
              <span className="mt-1 block pl-5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {description}
              </span>
            </label>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            size="0.9rem"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search memory or source…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2 pr-3 pl-9 text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as MemoryFilter)}
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        >
          <option value="active">Active</option>
          <option value="pinned">Pinned</option>
          <option value="deleted">Deleted</option>
          <option value="all">All</option>
        </select>
        <button
          type="button"
          onClick={() => setNewMemoryOpen((open) => !open)}
          aria-expanded={newMemoryOpen}
          aria-controls={newMemoryComposerId}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus size="0.9rem" /> New memory
        </button>
        <button
          type="button"
          onClick={exportMemories}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--accent)]"
        >
          <Upload size="0.9rem" /> Export
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--accent)]"
        >
          <Download size="0.9rem" /> Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </div>

      {newMemoryOpen && (
        <div id={newMemoryComposerId} className="rounded-2xl border border-[var(--primary)]/35 bg-[var(--card)] p-4">
          <label className="text-sm font-semibold text-[var(--foreground)]">
            New memory for {characterName}
          </label>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            This durable memory can follow the character into other chats.
          </p>
          <textarea
            aria-label="New character memory"
            value={newMemoryContent}
            onChange={(event) => setNewMemoryContent(event.target.value)}
            rows={4}
            autoFocus
            placeholder={`What should ${characterName} remember?`}
            className="mt-3 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setNewMemoryContent("");
                setNewMemoryOpen(false);
              }}
              disabled={createMemory.isPending}
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--accent)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveNewMemory()}
              disabled={!newMemoryContent.trim() || createMemory.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
            >
              <Check size="0.9rem" /> {createMemory.isPending ? "Saving…" : "Save memory"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {memoriesQuery.isLoading && (
          <div className="shimmer h-28 rounded-2xl" />
        )}
        {!memoriesQuery.isLoading && memories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] px-5 py-10 text-center">
            <Brain className="mx-auto text-[var(--muted-foreground)]" size="1.5rem" />
            <p className="mt-2 text-sm font-medium">No memories in this view</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Memories appear after chats, or you can import and copy them explicitly.
            </p>
          </div>
        )}
        {memories.map((memory) => (
          <article key={memory.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide">
                    {characterMemoryStatusLabel(memory.status)}
                  </span>
                  <span className="text-[0.7rem] text-[var(--muted-foreground)]">{memory.kind.replaceAll("_", " ")}</span>
                </div>
                {editingId === memory.id ? (
                  <textarea
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-[var(--primary)]/50 bg-[var(--background)] p-3 text-sm outline-none"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">{memory.content}</p>
                )}
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  {sourceLabel(memory)}
                  {memory.provenance.timestamp ? ` · ${new Date(memory.provenance.timestamp).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {editingId === memory.id ? (
                  <>
                    <button type="button" aria-label="Save memory" onClick={() => void saveEdit(memory.id)} className="rounded-lg p-2 hover:bg-[var(--accent)]">
                      <Check size="0.9rem" />
                    </button>
                    <button type="button" aria-label="Cancel editing" onClick={() => setEditingId(null)} className="rounded-lg p-2 hover:bg-[var(--accent)]">
                      <X size="0.9rem" />
                    </button>
                  </>
                ) : (
                  <>
                    {memory.status !== "deleted" && (
                      <>
                        <button
                          type="button"
                          aria-label="Edit memory"
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditingContent(memory.content);
                          }}
                          className="rounded-lg p-2 hover:bg-[var(--accent)]"
                        >
                          <Pencil size="0.9rem" />
                        </button>
                        <button
                          type="button"
                          aria-label={memory.status === "pinned" ? "Unpin memory" : "Pin memory"}
                          onClick={() => void changeStatus(memory, memory.status === "pinned" ? "active" : "pinned")}
                          className="rounded-lg p-2 hover:bg-[var(--accent)]"
                        >
                          <Pin size="0.9rem" className={memory.status === "pinned" ? "fill-current" : ""} />
                        </button>
                        <button type="button" aria-label="Delete memory" onClick={() => void changeStatus(memory, "deleted")} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10">
                          <Trash2 size="0.9rem" />
                        </button>
                      </>
                    )}
                    {memory.status === "deleted" && (
                      <button type="button" onClick={() => void changeStatus(memory, "active")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--accent)]">
                        <RotateCcw size="0.85rem" /> Restore
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <button type="button" onClick={() => setCopyOpen((open) => !open)} className="flex w-full items-center justify-between text-left">
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold"><Copy size="0.95rem" /> Copy memories from a chat</span>
            <span className="mt-1 block text-xs text-[var(--muted-foreground)]">Choose exact rows. Nothing is moved or copied automatically.</span>
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">{copyOpen ? "Close" : "Open"}</span>
        </button>
        {copyOpen && (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <select
              value={sourceChatId ?? ""}
              onChange={(event) => {
                setSourceChatId(event.target.value || null);
                setSelectedChatMemoryIds(new Set());
              }}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">Choose a chat containing {characterName}</option>
              {(sourceChats.data ?? []).map((chat) => (
                <option key={chat.id} value={chat.id}>{chat.name?.trim() || `Untitled ${chat.mode ?? "chat"}`}</option>
              ))}
            </select>
            {sourceChatId && (sourceRows.data ?? []).map((row) => {
              const id = String(row.id ?? "");
              const content = String(row.content ?? "").trim();
              if (!id || !content) return null;
              return (
                <label key={id} className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] p-3 hover:bg-[var(--accent)]">
                  <input
                    type="checkbox"
                    checked={selectedChatMemoryIds.has(id)}
                    onChange={(event) => setSelectedChatMemoryIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(id);
                      else next.delete(id);
                      return next;
                    })}
                    className="mt-1 accent-[var(--primary)]"
                  />
                  <span className="line-clamp-3 text-sm leading-relaxed">{content}</span>
                </label>
              );
            })}
            {sourceChatId && !sourceRows.isLoading && (sourceRows.data ?? []).length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">This chat has no local Memory Recall rows to copy.</p>
            )}
            <button
              type="button"
              disabled={selectedChatMemoryIds.size === 0 || importMemories.isPending}
              onClick={() => void copySelectedRows()}
              className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
            >
              Copy {selectedChatMemoryIds.size || ""} selected
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
