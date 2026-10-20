import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Loader2 } from "lucide-react";

import { Modal } from "../../../../shared/components/ui/Modal";
import { runCardCheck } from "../lib/card-check";
import { CardLintReview } from "./CardLintReview";

export type CardCheckModalProps = {
  open: boolean;
  onClose: () => void;
  /** Check only these saved characters (for example, the ones a folder import just added). */
  characterIds?: string[];
};

/** "Check my cards": the import card check, run on cards that are already saved. */
export function CardCheckModal({ open, onClose, characterIds }: CardCheckModalProps) {
  // One snapshot per opening: fixing a card must not refetch and drop it from the list.
  const check = useQuery({
    queryKey: ["card-check", characterIds ?? "all"],
    queryFn: () => runCardCheck(characterIds),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const result = check.data;

  return (
    <Modal open={open} onClose={onClose} title="Card check">
      <div className="flex flex-col gap-4">
        {check.isPending && (
          <p role="status" className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
            Checking your cards…
          </p>
        )}
        {check.isError && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            Couldn't check the cards: {check.error instanceof Error ? check.error.message : "unknown error"}
          </p>
        )}
        {result && result.flagged.length === 0 && (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs">
            <CheckCircle size="0.875rem" className="shrink-0 text-emerald-500" aria-hidden="true" />
            {result.checked === 0
              ? "No saved cards to check."
              : `Checked ${result.checked} card${result.checked === 1 ? "" : "s"}. Nothing to fix.`}
          </p>
        )}
        {result && result.flagged.length > 0 && (
          <>
            <p className="text-xs text-[var(--muted-foreground)]">
              Checked {result.checked} card{result.checked === 1 ? "" : "s"}. {result.flagged.length}{" "}
              {result.flagged.length === 1 ? "has" : "have"} something that may trip up the model.
            </p>
            {result.flagged.map((target) => (
              <CardLintReview key={target.characterId} {...target} />
            ))}
          </>
        )}
        <div className="flex justify-end border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
