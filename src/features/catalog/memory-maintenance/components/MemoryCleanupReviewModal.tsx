import { AlertTriangle, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo } from "react";

import type { MemoryCleanupScope, MemoryCleanupSource } from "../../../../engine/contracts/types/memory-maintenance";
import { Modal } from "../../../../shared/components/ui/Modal";
import { useMemoryCleanup } from "../hooks/use-memory-cleanup";

export interface MemoryCleanupReviewModalProps {
  open: boolean;
  scope: MemoryCleanupScope;
  sources: MemoryCleanupSource[];
  resolveConnectionId: () => Promise<string>;
  onClose: () => void;
  onChanged: () => Promise<unknown> | unknown;
}

function actionClass(primary = false): string {
  return primary
    ? "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-45"
    : "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--accent)] disabled:pointer-events-none disabled:opacity-45";
}

export function MemoryCleanupReviewModal({
  open,
  scope,
  sources,
  resolveConnectionId,
  onClose,
  onChanged,
}: MemoryCleanupReviewModalProps) {
  const controller = useMemoryCleanup({
    scope,
    sources,
    resolveConnectionId,
    onChanged,
  });
  const sourcesById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const selectedCount =
    controller.preview?.proposals.filter((proposal) => controller.selected[proposal.id] && proposal.type !== "conflict")
      .length ?? 0;
  const isBusy = controller.phase === "analyzing" || controller.phase === "applying" || controller.phase === "undoing";

  useEffect(() => {
    if (!open) controller.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    controller.cancelAnalysis();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Tidy memories" width="max-w-3xl">
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--primary)]/25 bg-[var(--primary)]/5 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 size="1rem" aria-hidden="true" />
            AI-assisted cleanup with review
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            Find repeated or overly wordy automatic memories. You review every change before anything is saved.
          </p>
        </div>

        {!controller.preview && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              Pinned, manually written, edited, imported, corrected, and tool-created memories will not be rewritten.
            </p>
            {sources.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]" role="status">
                There are no automatic memories available to analyze yet.
              </p>
            )}
            <button
              type="button"
              onClick={() => void controller.analyze().catch(() => undefined)}
              disabled={isBusy || sources.length === 0}
              className={actionClass(true)}
            >
              {controller.phase === "analyzing" ? (
                <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles size="0.875rem" aria-hidden="true" />
              )}
              {controller.phase === "analyzing" ? "Analyzing memories…" : "Analyze memories"}
            </button>
          </div>
        )}

        {controller.error && (
          <div
            role="alert"
            className="rounded-md border border-amber-400/35 bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size="0.9rem" className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{controller.error}</span>
            </div>
            {controller.preview && (
              <button
                type="button"
                onClick={() => void controller.analyze().catch(() => undefined)}
                disabled={isBusy}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                Analyze again
              </button>
            )}
          </div>
        )}

        {controller.preview && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--secondary)]/65 px-3 py-2 text-xs">
              <span className="font-semibold">
                <del className="text-[var(--muted-foreground)]">{controller.preview.beforeCount} memories</del>
                <span aria-hidden="true"> → </span>
                <span>{controller.preview.afterCount} memories</span>
              </span>
              <span className="text-[var(--muted-foreground)]">
                ~{controller.preview.estimatedTokensBefore.toLocaleString()} → ~
                {controller.preview.estimatedTokensAfter.toLocaleString()} tokens
              </span>
            </div>

            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              Pinned, manually written, edited, imported, corrected, and tool-created memories will not be rewritten.
              {controller.preview.protectedCount > 0
                ? ` ${controller.preview.protectedCount} protected memories are unchanged.`
                : ""}
            </p>

            {controller.preview.proposals.length === 0 ? (
              <div className="rounded-md border border-[var(--border)] p-4 text-sm">
                These memories already look tidy. Nothing needs to change.
              </div>
            ) : (
              <div className="space-y-3">
                {controller.preview.proposals.map((proposal) => {
                  const conflict = proposal.type === "conflict";
                  const referencedIds = [...proposal.sourceIds, ...(proposal.winnerId ? [proposal.winnerId] : [])];
                  return (
                    <article
                      key={proposal.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
                    >
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={controller.selected[proposal.id] ?? false}
                          disabled={conflict || isBusy}
                          onChange={(event) => controller.toggleProposal(proposal.id, event.currentTarget.checked)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-xs font-semibold">{proposal.reason}</span>
                          <span className="block text-[0.6875rem] text-[var(--muted-foreground)]">
                            ~{proposal.estimatedTokensBefore} → ~{proposal.estimatedTokensAfter} tokens
                          </span>
                        </span>
                      </label>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                            Before
                          </h4>
                          <div className="mt-1 space-y-1.5">
                            {referencedIds.map((sourceId) => (
                              <p
                                key={sourceId}
                                className="rounded bg-[var(--secondary)]/65 p-2 text-xs leading-relaxed"
                              >
                                {sourcesById.get(sourceId)?.content ?? "Memory unavailable"}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                            After
                          </h4>
                          {proposal.replacement ? (
                            <textarea
                              aria-label={`Replacement for ${proposal.reason}`}
                              value={controller.replacementText[proposal.id] ?? ""}
                              disabled={isBusy}
                              onChange={(event) => controller.updateReplacement(proposal.id, event.currentTarget.value)}
                              className="mt-1 min-h-24 w-full resize-y rounded border border-[var(--border)] bg-[var(--background)] p-2 text-xs leading-relaxed"
                            />
                          ) : proposal.winnerId ? (
                            <p className="mt-1 rounded bg-[var(--secondary)]/65 p-2 text-xs leading-relaxed">
                              {sourcesById.get(proposal.winnerId)?.content ?? "Retained memory unavailable"}
                            </p>
                          ) : (
                            <p className="mt-1 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-xs">
                              Possible conflict — nothing will be changed.
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {controller.preview.deferredCandidateCount > 0 && (
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                {controller.preview.deferredCandidateCount} additional candidate groups were deferred. Apply or analyze
                again in another pass.
              </p>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button type="button" onClick={close} className={actionClass()}>
            Cancel
          </button>
          {controller.preview && controller.phase !== "applied" && (
            <button
              type="button"
              onClick={() => void controller.analyze().catch(() => undefined)}
              disabled={isBusy}
              className={actionClass()}
            >
              Analyze again
            </button>
          )}
          {controller.lastBatchId ? (
            <button
              type="button"
              onClick={() => void controller.undo().catch(() => undefined)}
              disabled={isBusy}
              className={actionClass(true)}
            >
              {controller.phase === "undoing" ? (
                <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw size="0.875rem" aria-hidden="true" />
              )}
              Undo cleanup
            </button>
          ) : controller.preview && controller.preview.proposals.length > 0 ? (
            <button
              type="button"
              onClick={() => void controller.apply().catch(() => undefined)}
              disabled={isBusy || selectedCount === 0}
              className={actionClass(true)}
            >
              {controller.phase === "applying" && (
                <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
              )}
              Apply cleanup
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
