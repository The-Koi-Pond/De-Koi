import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Message } from "../../../../engine/contracts/types/chat";
import {
  emptyNarrativeCraftState,
  narrativeCraftStateFromLegacyMemory,
  normalizeNarrativeCraftState,
  type NarrativeCraftState,
  type NarrativeCraftThread,
} from "../../../../engine/generation/narrative-craft-state";
import { agentApi } from "../../../../shared/api/agent-api";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { QueryErrorState } from "../../../../shared/components/ui/QueryErrorState";
import { useGenerate } from "../../../runtime/generation";

const AGENT_TYPE = "narrative-craft";
const LEGACY_AGENT_TYPE = "secret-plot-driver";
const MEMORY_LABEL: Record<string, string> = {
  [AGENT_TYPE]: "Narrative Craft state",
  [LEGACY_AGENT_TYPE]: "Secret Plot memory",
};

function findLastAssistant(messages: Message[] | undefined): Message | null {
  if (!messages?.length) return null;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "assistant") return messages[index]!;
  }
  return null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isMissingAgentConfigError(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(record.message ?? "");
  return code === "not_found" || /agent is not configured/i.test(message);
}

async function loadPanelState(chatId: string): Promise<NarrativeCraftState> {
  let currentError: unknown = null;
  try {
    const current = await agentApi.getMemory(AGENT_TYPE, chatId);
    if (current.memory && Object.prototype.hasOwnProperty.call(current.memory, "state")) {
      return normalizeNarrativeCraftState(parseMaybeJson(current.memory.state));
    }
  } catch (error) {
    if (!isMissingAgentConfigError(error)) currentError = error;
  }

  let legacyError: unknown = null;
  try {
    const legacy = await agentApi.getMemory(LEGACY_AGENT_TYPE, chatId);
    if (legacy.memory && Object.keys(legacy.memory).length > 0) {
      return narrativeCraftStateFromLegacyMemory(legacy.memory);
    }
  } catch (error) {
    if (!isMissingAgentConfigError(error)) legacyError = error;
  }

  if (currentError) throw currentError;
  if (legacyError) throw legacyError;
  return emptyNarrativeCraftState();
}

function titleCase(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function ThreadList({ threads }: { threads: NarrativeCraftThread[] }) {
  if (threads.length === 0) return <EmptyLine text="No live threads tracked." />;
  return (
    <ul className="space-y-1">
      {threads.map((thread) => (
        <li
          key={thread.id}
          className="rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/30 px-2 py-1.5"
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[0.625rem] leading-relaxed text-[var(--popover-foreground)]">
              {thread.summary}
            </span>
            <span className="shrink-0 rounded bg-[var(--primary)]/10 px-1 py-0.5 text-[0.5rem] font-medium text-[var(--primary)]">
              {titleCase(thread.status)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)]">{text}</p>;
}

function TextList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <EmptyLine text={empty} />;
  return (
    <ul className="space-y-1 text-[0.625rem] leading-relaxed text-[var(--popover-foreground)]">
      {values.map((value) => (
        <li key={value} className="flex gap-1.5">
          <span aria-hidden className="text-[var(--primary)]">
            •
          </span>
          <span>{value}</span>
        </li>
      ))}
    </ul>
  );
}

function StateSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)]/55 px-2 py-1.5">
      <h4 className="mb-1 text-[0.5625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function NarrativeCraftPanel({
  chatId,
  messages,
  isGenerationBusy = false,
}: {
  chatId: string | null;
  messages: Message[] | undefined;
  isAgentProcessing?: boolean;
  isGenerationBusy?: boolean;
}) {
  const queryClient = useQueryClient();
  const { retryAgents } = useGenerate();
  const [reanalyzing, setReanalyzing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearFailures, setClearFailures] = useState<string[]>([]);
  const target = useMemo(() => findLastAssistant(messages), [messages]);
  const queryKey = useMemo(() => ["agent-memory", AGENT_TYPE, chatId ?? ""] as const, [chatId]);
  const {
    data: state,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    enabled: !!chatId,
    queryFn: () => loadPanelState(chatId!),
  });
  const current = state ?? emptyNarrativeCraftState();
  const mainThreads = current.threads.filter((thread) => thread.kind === "main");
  const subplotThreads = current.threads.filter((thread) => thread.kind === "subplot");

  const handleReanalyze = useCallback(async () => {
    if (!chatId || !target || isGenerationBusy || reanalyzing) return;
    setReanalyzing(true);
    try {
      await retryAgents(chatId, [AGENT_TYPE], { forMessageId: target.id });
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setReanalyzing(false);
    }
  }, [chatId, isGenerationBusy, queryClient, queryKey, reanalyzing, refetch, retryAgents, target]);

  const handleClear = useCallback(async () => {
    if (!chatId || clearing) return;
    const confirmed = await showConfirmDialog({
      title: "Clear Narrative Craft state",
      message:
        "Clear the current craft state and any legacy Secret Plot memory for this chat? Agent settings and run history will be kept.",
      confirmLabel: "Clear State",
      tone: "destructive",
    });
    if (!confirmed) return;
    setClearing(true);
    try {
      const results = await Promise.allSettled([
        agentApi.clearMemory(AGENT_TYPE, chatId),
        agentApi.clearMemory(LEGACY_AGENT_TYPE, chatId),
      ]);
      const failedAgentTypes = [AGENT_TYPE, LEGACY_AGENT_TYPE].filter(
        (_, index) => results[index]?.status === "rejected",
      );
      if (failedAgentTypes.length > 0) {
        setClearFailures(failedAgentTypes);
        toast.error("Some saved craft state could not be cleared. Reloaded the remaining state.");
        await queryClient.invalidateQueries({ queryKey });
        await refetch();
        return;
      }
      setClearFailures([]);
      queryClient.setQueryData(queryKey, emptyNarrativeCraftState());
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setClearing(false);
    }
  }, [chatId, clearing, queryClient, queryKey, refetch]);

  if (!chatId) return null;

  return (
    <div className="space-y-1.5 bg-[var(--popover)]/35 px-2 py-2 text-[var(--popover-foreground)]">
      {isLoading && (
        <p className="py-3 text-center text-[0.625rem] text-[var(--muted-foreground)]">Loading craft state...</p>
      )}
      {isError && (
        <QueryErrorState
          title="Narrative Craft state unavailable"
          message="The saved craft state could not be loaded."
          onRetry={() => void refetch()}
          compact
        />
      )}
      {!isLoading && !isError && (
        <>
          <StateSection title="Current guidance">
            {current.lastGuidance.length > 0 ? (
              <TextList values={current.lastGuidance} empty="" />
            ) : (
              <p className="text-[0.625rem] font-medium text-[var(--primary)]">No intervention needed</p>
            )}
          </StateSection>

          <div className="grid grid-cols-2 gap-1.5">
            <StateSection title="Pacing">
              <p className="text-[0.625rem] font-medium text-[var(--popover-foreground)]">
                {titleCase(current.pacing)}
              </p>
            </StateSection>
            <StateSection title="Last analysis">
              <EmptyLine text={current.lastAnalysisReason || "No analysis recorded yet."} />
            </StateSection>
          </div>

          <StateSection title="Main threads">
            <ThreadList threads={mainThreads} />
          </StateSection>
          <StateSection title="Subplots and unresolved threads">
            <ThreadList threads={subplotThreads} />
          </StateSection>
          <StateSection title="Open questions">
            <TextList values={current.openQuestions} empty="No open questions tracked." />
          </StateSection>
          <StateSection title="Unresolved consequences">
            <TextList values={current.unresolvedConsequences} empty="No unresolved consequences tracked." />
          </StateSection>

          {clearFailures.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-[var(--destructive)]/35 bg-[var(--destructive)]/10 px-2 py-1.5 text-[0.625rem] leading-relaxed text-[var(--destructive)]"
            >
              <p className="font-semibold">Craft state was only partly cleared</p>
              <ul className="mt-0.5 list-disc pl-4">
                {clearFailures.map((agentType) => (
                  <li key={agentType}>{MEMORY_LABEL[agentType] ?? agentType} is still saved.</li>
                ))}
              </ul>
              <p className="mt-0.5">
                The state shown above is what remains. Retry clear to remove the remaining saved state.
              </p>
            </div>
          )}

          <div className="flex gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={!target || isGenerationBusy || reanalyzing}
              onClick={() => void handleReanalyze()}
              className="inline-flex min-h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)]/15 px-2 py-1 text-[0.625rem] font-semibold text-[var(--primary)] ring-1 ring-[var(--primary)]/25 transition-colors hover:bg-[var(--primary)]/20 disabled:opacity-40"
            >
              <RefreshCw size="0.6875rem" className={reanalyzing ? "animate-spin" : ""} />
              Re-analyze now
            </button>
            <button
              type="button"
              disabled={clearing || isGenerationBusy}
              onClick={() => void handleClear()}
              className="inline-flex min-h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--destructive)]/10 px-2 py-1 text-[0.625rem] font-medium text-[var(--destructive)] ring-1 ring-[var(--destructive)]/20 transition-colors hover:bg-[var(--destructive)]/15 disabled:opacity-40"
            >
              <Trash2 size="0.6875rem" />
              {clearFailures.length > 0 ? "Retry clear" : "Clear craft state"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
