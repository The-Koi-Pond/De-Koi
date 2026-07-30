import { useCallback, useEffect, useState } from "react";

import type { MemoryCleanupTarget } from "../../../../engine/contracts/types/memory-maintenance";
import { memoryMaintenanceApi } from "../../../../shared/api/memory-maintenance-api";
import { storageApi } from "../../../../shared/api/storage-api";

export interface MemoryMaintenanceRecoveryProps {
  targets: MemoryCleanupTarget[];
  onChanged(): void | Promise<void>;
}

interface CompletedMaintenanceJob {
  id: string;
  targetKey: string;
  target: MemoryCleanupTarget;
  status: string;
  updatedAt?: string;
  lastBatchId: string;
  lastResult: {
    combined?: number;
    discarded?: number;
  };
}

function targetKey(target: MemoryCleanupTarget): string {
  return `${target.store}:${target.scope.kind}:${target.scope.id}`;
}

function resultCount(job: CompletedMaintenanceJob): number {
  return Math.max(0, Number(job.lastResult.combined) || 0) + Math.max(0, Number(job.lastResult.discarded) || 0);
}

function summary(job: CompletedMaintenanceJob): string {
  const combined = Math.max(0, Number(job.lastResult.combined) || 0);
  const discarded = Math.max(0, Number(job.lastResult.discarded) || 0);
  if (combined > 0 && discarded > 0) {
    return `Memory maintenance combined ${combined} and removed ${discarded}.`;
  }
  if (combined > 0) return `Memory maintenance combined ${combined}.`;
  return `Memory maintenance removed ${discarded}.`;
}

export function MemoryMaintenanceRecovery({ targets, onChanged }: MemoryMaintenanceRecoveryProps) {
  const [job, setJob] = useState<CompletedMaintenanceJob | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(false);

  const load = useCallback(async () => {
    const targetsByKey = new Map(targets.map((target) => [targetKey(target), target]));
    const rows = await storageApi
      .list<CompletedMaintenanceJob>("memory-maintenance-jobs", {
        filters: { status: "completed" },
      })
      .catch(() => []);
    setJob(
      rows
        .filter(
          (row) =>
            targetsByKey.has(row.targetKey) &&
            Boolean(row.lastBatchId) &&
            Boolean(row.lastResult) &&
            resultCount(row) > 0,
        )
        .map((row) => ({ ...row, target: targetsByKey.get(row.targetKey)! }))
        .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null,
    );
  }, [targets]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!job) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
      <span>{undoError ? "Undo could not finish. The maintenance changes are still active." : summary(job)}</span>
      <button
        type="button"
        disabled={undoing}
        onClick={() => {
          setUndoError(false);
          setUndoing(true);
          void memoryMaintenanceApi
            .undo({ version: 2, target: job.target, batchId: job.lastBatchId })
            .then(async () => {
              setJob(null);
              await onChanged();
            })
            .catch(() => setUndoError(true))
            .finally(() => setUndoing(false));
        }}
        className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 font-semibold text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
      >
        {undoing ? "Undoing…" : "Undo"}
      </button>
    </div>
  );
}
