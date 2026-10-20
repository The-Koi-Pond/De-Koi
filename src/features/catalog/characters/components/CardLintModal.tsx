import { Modal } from "../../../../shared/components/ui/Modal";
import type { CardLintTarget } from "../lib/card-lint-target";
import { CardLintReview } from "./CardLintReview";

export type CardLintModalProps = CardLintTarget & { open: boolean; onClose: () => void };

export function CardLintModal({ open, onClose, ...target }: CardLintModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Card check">
      <div className="flex flex-col gap-4">
        <CardLintReview {...target} />
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
