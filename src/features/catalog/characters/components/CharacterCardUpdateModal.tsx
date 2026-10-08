// ──────────────────────────────────────────────
// Modal: Confirm character_card_update agent result
// ──────────────────────────────────────────────
//
// The Card Evolution Auditor post-processing agent proposes edits to a
// character card's fields (description, personality, etc.) based on what
// happened in the roleplay. Unlike the Lorebook Keeper, card edits require
// the user's explicit approval — this modal shows the old → new diff and
// asks the user to approve or reject each batch.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserCog, Check, X, AlertCircle } from "lucide-react";
import { Modal } from "../../../../shared/components/ui/Modal";
import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useCharacter, useUpdateCharacter } from "../hooks/use-characters";
import { approveCardEvolutionReview, rejectCardEvolutionReview } from "../lib/card-evolution-reviews";
import type { EditableCharacterCardField } from "../../../../engine/contracts/types/agent";

function getCharacterCardFieldValue(data: Record<string, unknown>, field: EditableCharacterCardField): string | null {
  if (field === "backstory" || field === "appearance") {
    const extensions = data.extensions;
    if (!extensions || typeof extensions !== "object") return null;
    const value = (extensions as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  }

  const value = data[field];
  return typeof value === "string" ? value : null;
}

function setCharacterCardFieldValue(
  data: Record<string, unknown>,
  field: EditableCharacterCardField,
  value: string,
): Record<string, unknown> {
  if (field === "backstory" || field === "appearance") {
    const extensions =
      data.extensions && typeof data.extensions === "object" ? (data.extensions as Record<string, unknown>) : {};

    return {
      ...data,
      extensions: {
        ...extensions,
        [field]: value,
      },
    };
  }

  return {
    ...data,
    [field]: value,
  };
}

function bumpCharacterVersion(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "1.1";
  const match = raw.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return `${raw}.1`;
  const prefix = match[1] ?? "";
  const numberPart = match[2] ?? "0";
  const suffix = match[3] ?? "";
  const next = String(Number(numberPart) + 1).padStart(numberPart.length, "0");
  return `${prefix}${next}${suffix}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CharacterCardUpdateModal({ open, onClose }: Props) {
  const pending = useAgentStore((s) => s.pendingCardUpdates);
  const dismissPendingCardUpdate = useAgentStore((s) => s.dismissPendingCardUpdate);

  const entry = pending[0] ?? null;
  const { data: character } = useCharacter(entry?.characterId ?? null);
  const updateCharacter = useUpdateCharacter();
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  // Character rows come back from /characters with `data` serialized as a JSON
  // string, so parse it once here and reuse below.
  const parsedData = useMemo((): Record<string, unknown> => {
    const raw = (character as { data?: unknown } | undefined)?.data;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return (raw as Record<string, unknown>) ?? {};
  }, [character]);

  // Only show updates whose oldText is still present in the current field —
  // stale suggestions (field already changed since the agent ran) are dropped.
  // We use substring match, not equality, because oldText is a sentence-level
  // slice of a field that often contains multiple paragraphs.
  const applicableUpdates = useMemo(() => {
    if (!entry || !character) return [];
    return entry.updates.filter((u) => {
      const current = getCharacterCardFieldValue(parsedData, u.field);
      return typeof current === "string" && u.oldText.length > 0 && current.includes(u.oldText);
    });
  }, [entry, character, parsedData]);

  if (!entry) return null;

  const advance = () => {
    dismissPendingCardUpdate(entry.id);
    setError(null);
    // If another pending update is queued, keep the modal open so the user
    // can triage them in sequence; otherwise close.
    if (pending.length <= 1) {
      onClose();
    }
  };

  const applyToCard = async () => {
    // Apply each edit as a targeted substring replace inside the field's current
    // value, NOT by overwriting the field with newText (which would erase
    // everything around the edited sentence).
    // Each edit must still find its text after the ones before it; two edits to the same passage
    // would otherwise drop one silently while the batch is recorded as applied.
    let nextData: Record<string, unknown> = { ...parsedData };
    for (const u of applicableUpdates) {
      const base = getCharacterCardFieldValue(nextData, u.field);
      if (typeof base !== "string" || !base.includes(u.oldText)) {
        throw new Error(
          `Two of these edits change the same ${u.field} text, so they can't all be applied. Reject them.`,
        );
      }
      nextData = setCharacterCardFieldValue(nextData, u.field, base.replace(u.oldText, u.newText));
    }
    nextData.character_version = bumpCharacterVersion(nextData.character_version);
    await updateCharacter.mutateAsync({
      id: entry.characterId,
      data: nextData,
      versionSource: "agent",
      versionReason: `${entry.agentName} card update`,
    });
  };

  // Proposals stored on a recovered run are decided there atomically: if another tab decided them first
  // this one just moves on, and if the decision can't be saved they stay here with the error.
  const handleApprove = async () => {
    if (!character || applicableUpdates.length === 0 || deciding) return;
    setDeciding(true);
    setError(null);
    try {
      if ((await approveCardEvolutionReview(entry, applyToCard)) === "already-reviewed") {
        toast(`${entry.characterName}'s card update was already reviewed.`);
      }
      advance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply character updates");
    } finally {
      setDeciding(false);
    }
  };

  // Rejecting (or closing the dialog) settles stored proposals too, so they are not offered again.
  const closeAndAdvance = async () => {
    if (deciding) return;
    setDeciding(true);
    setError(null);
    try {
      if ((await rejectCardEvolutionReview(entry)) === "already-reviewed") {
        toast(`${entry.characterName}'s card update was already reviewed.`);
      }
      advance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the rejection.");
    } finally {
      setDeciding(false);
    }
  };

  const handleReject = () => void closeAndAdvance();

  const queueNote = pending.length > 1 ? ` (${pending.length - 1} more queued)` : "";

  return (
    <Modal open={open} onClose={() => void closeAndAdvance()} title="Review Character Card Updates" width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 shadow-lg shadow-violet-400/20">
            <UserCog size="1.375rem" className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {(typeof parsedData.name === "string" && parsedData.name) || entry.characterName}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {entry.agentName} proposed {entry.updates.length} {entry.updates.length === 1 ? "change" : "changes"}
              {queueNote}
            </p>
          </div>
        </div>

        {applicableUpdates.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] p-2.5 text-xs text-[var(--muted-foreground)]">
            <AlertCircle size="0.75rem" className="shrink-0" />
            None of these proposals still match the current card — the field was probably already edited. Reject to
            dismiss.
          </div>
        )}

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {entry.updates.map((u, idx) => {
            const stale = !applicableUpdates.includes(u);
            return (
              <div
                key={idx}
                className={`flex flex-col gap-2 rounded-lg bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)] ${
                  stale ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {u.field}
                  </span>
                  {stale && (
                    <span className="rounded-full bg-[var(--destructive)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--destructive)]">
                      stale
                    </span>
                  )}
                </div>
                {u.reason && <p className="text-xs italic text-[var(--muted-foreground)]">{u.reason}</p>}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    Before
                  </span>
                  <p className="whitespace-pre-wrap rounded-md bg-[var(--destructive)]/5 p-2 text-xs leading-relaxed text-[var(--foreground)]">
                    {u.oldText}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    After
                  </span>
                  <p className="whitespace-pre-wrap rounded-md bg-emerald-500/5 p-2 text-xs leading-relaxed text-[var(--foreground)]">
                    {u.newText}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--destructive)]/10 p-2.5 text-xs text-[var(--destructive)]">
            <AlertCircle size="0.75rem" className="shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={handleReject}
            disabled={deciding}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
          >
            <X size="0.75rem" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={deciding || applicableUpdates.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-50"
          >
            {deciding ? <Loader2 size="0.75rem" className="animate-spin" /> : <Check size="0.75rem" />}
            Approve {applicableUpdates.length > 0 ? `(${applicableUpdates.length})` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
