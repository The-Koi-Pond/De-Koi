import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../../../../shared/components/ui/Modal";
import {
  buildSaveMomentLoreDraft,
  type SaveMomentLoreDraftSource,
} from "../../../../../shared/lib/save-moment-lore-draft";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useCreateLorebookEntry, useLorebooks } from "../../hooks/use-lorebooks";
import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";

export interface SaveMomentLoreDraftModalProps {
  open: boolean;
  onClose: () => void;
  source?: SaveMomentLoreDraftSource | null;
}

function parseKeys(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  );
}

export function SaveMomentLoreDraftModal({ open, onClose, source }: SaveMomentLoreDraftModalProps) {
  const { data: rawLorebooks = [], isLoading } = useLorebooks();
  const createEntry = useCreateLorebookEntry();
  const openLorebookEntryDetail = useUIStore((state) => state.openLorebookEntryDetail);
  const lorebooks = rawLorebooks as Lorebook[];
  const draft = useMemo(() => (source ? buildSaveMomentLoreDraft(source) : null), [source]);
  const [targetLorebookId, setTargetLorebookId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [keys, setKeys] = useState("");

  useEffect(() => {
    if (!open || !draft) return;
    setTargetLorebookId((current) => current || lorebooks[0]?.id || "");
    setName(draft.name);
    setDescription(draft.description);
    setContent(draft.content);
    setKeys(draft.keys.join(", "));
  }, [draft, lorebooks, open]);

  const canCreate = !!draft && !!targetLorebookId && !!name.trim() && !!content.trim() && !createEntry.isPending;

  const handleCreate = async () => {
    if (!draft || !canCreate) return;
    try {
      const entry = await createEntry.mutateAsync({
        lorebookId: targetLorebookId,
        name: name.trim(),
        description: description.trim(),
        content: content.trim(),
        keys: parseKeys(keys),
        enabled: false,
        sourceChatId: draft.sourceChatId,
        sourceMessageId: draft.sourceMessageId,
      });
      const entryId = entry && typeof entry === "object" && "id" in entry ? String(entry.id) : null;
      onClose();
      if (entryId) openLorebookEntryDetail(targetLorebookId, entryId);
      toast.success("Lore draft created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create lore draft");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Draft Lore Entry" width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/25">
            <BookOpen size="1.125rem" />
          </div>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Create a disabled lorebook entry draft from this message. Review and enable it in the lorebook editor when
            it is ready for prompts.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Target lorebook</span>
          <select
            value={targetLorebookId}
            onChange={(event) => setTargetLorebookId(event.target.value)}
            disabled={isLoading || lorebooks.length === 0}
            className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60"
          >
            {lorebooks.length === 0 ? (
              <option value="">No lorebooks available</option>
            ) : (
              lorebooks.map((lorebook) => (
                <option key={lorebook.id} value={lorebook.id}>
                  {lorebook.name}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Entry name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            className="resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Primary keys</span>
          <input
            value={keys}
            onChange={(event) => setKeys(event.target.value)}
            placeholder="Comma-separated trigger words"
            className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Content</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={7}
            className="resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>

        {createEntry.isError && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--destructive)]/10 p-2.5 text-xs text-[var(--destructive)]">
            <AlertCircle size="0.75rem" className="shrink-0" />
            {createEntry.error instanceof Error ? createEntry.error.message : "Failed to create lore draft"}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-50"
          >
            {createEntry.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <BookOpen size="0.75rem" />}
            Create Draft
          </button>
        </div>
      </div>
    </Modal>
  );
}
