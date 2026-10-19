import { ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import { useState } from "react";
import type { RoleplayQualityCorrectionExtra } from "../../../../../engine/contracts/types/chat";

type CorrectionReason = RoleplayQualityCorrectionExtra["reasons"][number];

const REASON_LABELS: Record<CorrectionReason, string> = {
  agency: "kept your character's choices yours",
  repetition: "cut a repeated line",
  continuity: "fixed a contradiction",
  pacing: "trimmed padding",
  malformed: "removed garbled text",
};

function sameText(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

/**
 * Says when De-Koi's automatic check edited this reply, shows the exact change, and lets the user put the model's
 * original back. The restore is offered only while the reply still reads the way the correction left it, so it never
 * overwrites the user's own later edits.
 */
export function RoleplayQualityCorrectionNotice({
  correction,
  content,
  messageId,
  onEdit,
}: {
  correction?: RoleplayQualityCorrectionExtra | null;
  content: string;
  messageId: string;
  onEdit?: (messageId: string, content: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  if (!correction || correction.reasons.length === 0) return null;
  const original = typeof correction.originalContent === "string" ? correction.originalContent : null;
  if (original !== null && sameText(content, original)) return null;
  if (typeof correction.correctedContent === "string" && !sameText(content, correction.correctedContent)) return null;

  const summary = correction.reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(", ");
  const edits = correction.edits ?? [];
  const canRestore = original !== null && !!onEdit;
  return (
    <div className="mt-2 w-fit max-w-full rounded-md border border-[var(--border)] bg-[var(--secondary)]/60 px-2.5 py-1.5 text-xs text-[var(--muted-foreground)]">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--accent)]"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDown size="0.75rem" aria-hidden="true" />
          ) : (
            <ChevronRight size="0.75rem" aria-hidden="true" />
          )}
          <span>Auto-fixed: {summary}</span>
        </button>
        {canRestore ? (
          <button
            type="button"
            aria-label="Restore the original reply"
            disabled={restoring}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
            onClick={async () => {
              setRestoring(true);
              try {
                await onEdit?.(messageId, original);
              } finally {
                setRestoring(false);
              }
            }}
          >
            <Undo2 size="0.75rem" aria-hidden="true" />
            Restore original
          </button>
        ) : null}
      </div>
      {open ? (
        edits.length > 0 ? (
          <ul className="mt-1.5 space-y-1.5">
            {edits.map((edit, index) => (
              <li key={`${index}-${edit.before.slice(0, 24)}`} className="leading-relaxed">
                <span className="line-through decoration-[var(--muted-foreground)]">{edit.before}</span>
                {edit.after ? <span className="text-[var(--foreground)]"> → {edit.after}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 leading-relaxed">
            Changed: {correction.evidence.map((excerpt) => `"${excerpt}"`).join("; ")}
          </p>
        )
      ) : null}
    </div>
  );
}
