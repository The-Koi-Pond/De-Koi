import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MemoryCleanupPreview,
  MemoryCleanupProposal,
  MemoryCleanupScope,
  MemoryCleanupSource,
} from "../../../../engine/contracts/types/memory-maintenance";
import { MEMORY_CLEANUP_MAX_SELECTED_PROPOSALS } from "../../../../engine/contracts/types/memory-maintenance";
import {
  analyzeMemoryCleanup,
  type MemoryCleanupAnalysisProgress,
} from "../../../../engine/generation/memory-cleanup";
import { llmApi } from "../../../../shared/api/llm-api";
import { memoryMaintenanceApi } from "../../../../shared/api/memory-maintenance-api";

export type MemoryCleanupPhase = "idle" | "analyzing" | "preview" | "applying" | "applied" | "undoing" | "error";

export interface UseMemoryCleanupInput {
  scope: MemoryCleanupScope;
  sources: MemoryCleanupSource[];
  resolveConnectionId: () => Promise<string>;
  onChanged: () => Promise<unknown> | unknown;
}

function ownerKey(scope: MemoryCleanupScope): string {
  return `${scope.kind}:${scope.id}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function useMemoryCleanup(input: UseMemoryCleanupInput) {
  const { scope, sources, resolveConnectionId, onChanged } = input;
  const key = ownerKey(scope);
  const keyRef = useRef(key);
  keyRef.current = key;
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<MemoryCleanupPhase>("idle");
  const [preview, setPreview] = useState<MemoryCleanupPreview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [replacementText, setReplacementText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<MemoryCleanupAnalysisProgress | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setPreview(null);
    setSelected({});
    setReplacementText({});
    setError(null);
    setLastBatchId(null);
    setAnalysisProgress(null);
  }, []);

  useEffect(() => {
    reset();
  }, [key, reset]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const analyze = useCallback(async () => {
    const analysisKey = key;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase("analyzing");
    setError(null);
    setLastBatchId(null);
    setAnalysisProgress(null);
    try {
      const connectionId = (await resolveConnectionId()).trim();
      if (!connectionId) throw new Error("AI cleanup needs a configured text connection.");
      const nextPreview = await analyzeMemoryCleanup({
        scope,
        sources,
        connectionId,
        llm: llmApi,
        signal: abort.signal,
        onProgress: (progress) => {
          if (keyRef.current === analysisKey && !abort.signal.aborted) setAnalysisProgress(progress);
        },
      });
      if (keyRef.current !== analysisKey || abort.signal.aborted) return;
      setAnalysisProgress(null);
      setPreview(nextPreview);
      setSelected(
        Object.fromEntries(
          nextPreview.proposals.map((proposal) => [
            proposal.id,
            proposal.type !== "discard" && proposal.selected && proposal.type !== "conflict",
          ]),
        ),
      );
      setReplacementText(
        Object.fromEntries(
          nextPreview.proposals
            .filter((proposal) => proposal.replacement)
            .map((proposal) => [proposal.id, proposal.replacement?.content ?? ""]),
        ),
      );
      setPhase("preview");
    } catch (analysisError) {
      if (abort.signal.aborted || keyRef.current !== analysisKey) return;
      setAnalysisProgress(null);
      setError(errorMessage(analysisError, "Memory cleanup analysis failed."));
      setPhase("error");
      throw analysisError;
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [key, resolveConnectionId, scope, sources]);

  const toggleProposal = useCallback((proposalId: string, nextSelected: boolean) => {
    setSelected((current) => ({ ...current, [proposalId]: nextSelected }));
  }, []);

  const updateReplacement = useCallback((proposalId: string, content: string) => {
    setReplacementText((current) => ({ ...current, [proposalId]: content }));
  }, []);

  const selectedProposals = useCallback((): MemoryCleanupProposal[] => {
    if (!preview) return [];
    return preview.proposals
      .filter((proposal) => selected[proposal.id] && proposal.type !== "conflict")
      .map((proposal) => ({
        ...proposal,
        selected: true,
        ...(proposal.replacement
          ? {
              replacement: {
                ...proposal.replacement,
                content: replacementText[proposal.id]?.trim() ?? "",
              },
            }
          : {}),
      }));
  }, [preview, replacementText, selected]);

  const apply = useCallback(async () => {
    if (!preview || ownerKey(preview.scope) !== keyRef.current) {
      // Navigation invalidates the preview. A stale click/event is a benign
      // no-op; keep the new owner in a clean, immediately actionable state.
      setPreview(null);
      setPhase("idle");
      setError(null);
      return undefined;
    }
    const proposals = selectedProposals();
    if (proposals.length === 0) throw new Error("Select at least one cleanup change.");
    if (proposals.length > MEMORY_CLEANUP_MAX_SELECTED_PROPOSALS) {
      throw new Error(
        `Select at most ${MEMORY_CLEANUP_MAX_SELECTED_PROPOSALS.toLocaleString()} cleanup changes at once.`,
      );
    }
    if (proposals.some((proposal) => proposal.replacement && !proposal.replacement.content.trim())) {
      throw new Error("Replacement memories cannot be empty.");
    }
    setPhase("applying");
    setError(null);
    try {
      const result = await memoryMaintenanceApi.apply({
        version: 1,
        scope,
        proposals,
      });
      await onChanged();
      if (keyRef.current !== key) return result;
      setLastBatchId(result.batchId);
      setPhase("applied");
      return result;
    } catch (applyError) {
      if (keyRef.current === key) {
        setError(errorMessage(applyError, "Memory cleanup could not be applied."));
        setPhase("error");
      }
      throw applyError;
    }
  }, [key, onChanged, preview, scope, selectedProposals]);

  const undo = useCallback(async () => {
    if (!lastBatchId) throw new Error("There is no cleanup batch to undo.");
    setPhase("undoing");
    setError(null);
    try {
      const result = await memoryMaintenanceApi.undo({
        scope,
        batchId: lastBatchId,
      });
      await onChanged();
      if (keyRef.current !== key) return result;
      setLastBatchId(null);
      setPhase("preview");
      return result;
    } catch (undoError) {
      if (keyRef.current === key) {
        setError(errorMessage(undoError, "Memory cleanup could not be undone."));
        setPhase("error");
      }
      throw undoError;
    }
  }, [key, lastBatchId, onChanged, scope]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAnalysisProgress(null);
    setPhase(preview ? "preview" : "idle");
  }, [preview]);

  return {
    phase,
    preview,
    selected,
    replacementText,
    error,
    lastBatchId,
    analysisProgress,
    analyze,
    apply,
    undo,
    toggleProposal,
    updateReplacement,
    cancelAnalysis,
    reset,
  };
}
