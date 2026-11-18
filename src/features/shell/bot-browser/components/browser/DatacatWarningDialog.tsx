import { TriangleAlert } from "lucide-react";

import { Modal } from "../../../../../shared/components/ui/Modal";

/** Asked the first time in an app session someone picks DataCat. Closing it any way but Continue stays put. */
export function DatacatWarningDialog({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  return (
    <Modal open onClose={onCancel} title="DataCat is NSFW only">
      <div className="space-y-4 text-sm text-[var(--foreground)]">
        <div className="flex items-start gap-3">
          <TriangleAlert size="1.25rem" aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500" />
          <p>Every character on DataCat is tagged NSFW upstream, so the NSFW filter is locked on for this provider.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--accent)]"
          >
            Don't continue to DataCat
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="h-8 rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
          >
            Continue to DataCat
          </button>
        </div>
      </div>
    </Modal>
  );
}
