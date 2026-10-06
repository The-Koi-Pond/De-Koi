export interface AgentFailure {
  agentType: string;
  agentName: string;
  error: string | null;
  reasonLabel: string | null;
}

interface RawAgentFailure {
  agentType: string;
  agentName?: string | null;
  error?: string | null;
}

function classifyAgentFailureReason(error: string | null | undefined): string | null {
  if (!error) return null;
  const value = error.toLowerCase();

  if (
    /\b(max(?:imum)? length|too many tokens|prompt too long|context_length_exceeded)\b/.test(value) ||
    (/\b(context|prompt|input)\b/.test(value) &&
      /\b(limit|length|window|too long|max(?:imum)? tokens?|tokens? limit)\b/.test(value))
  ) {
    return "Context limit";
  }
  if (/\b(timed?\s*out|timeout|etimedout|deadline|aborted|aborterror)\b/.test(value)) {
    return "Timeout";
  }
  if (/\b(refus(?:ed|al)|reject(?:ed|ion)|blocked|content policy|safety|moderation)\b/.test(value)) {
    return "Rejection";
  }
  if (/\b(unauthorized|forbidden|invalid api key|api key|401|403|permission|credential|auth)\b/.test(value)) {
    return "Authentication";
  }
  if (/\b(rate limit|too many requests|quota|429)\b/.test(value)) {
    return "Rate limit";
  }
  if (/\b(network|fetch failed|econn|enotfound|dns|socket|connection|connect)\b/.test(value)) {
    return "Connection";
  }
  if (/\b(json|parse|schema|invalid response|malformed)\b/.test(value)) {
    return "Invalid response";
  }
  if (/\btool\b/.test(value)) {
    return "Tool error";
  }

  return null;
}

export function toAgentFailure(raw: RawAgentFailure): AgentFailure {
  const fallbackName = raw.agentType.trim() || "Agent";
  const agentName = raw.agentName?.trim() || fallbackName;
  const error = raw.error?.trim() || null;

  return {
    agentType: raw.agentType,
    agentName,
    error,
    reasonLabel: classifyAgentFailureReason(error),
  };
}

export function formatAgentFailureTitle(failure: AgentFailure): string {
  return failure.reasonLabel ? `${failure.agentName} (${failure.reasonLabel})` : failure.agentName;
}

export function formatAgentFailureDetail(failure: AgentFailure): string {
  if (failure.reasonLabel && failure.error) return `${failure.reasonLabel}: ${failure.error}`;
  if (failure.reasonLabel) return failure.reasonLabel;
  return failure.error ?? "No error details were provided.";
}

export function formatAgentFailuresToast(failures: AgentFailure[]): string {
  if (failures.length === 0) return "Agent retry failed.";

  if (failures.length === 1) {
    const failure = failures[0]!;
    const reason = failure.reasonLabel ? `: ${failure.reasonLabel}` : "";
    return `${failure.agentName} failed${reason}. Use the retry controls to try again.`;
  }

  const visible = failures.slice(0, 3).map(formatAgentFailureTitle).join(", ");
  const remaining = failures.length > 3 ? `, +${failures.length - 3} more` : "";
  return `${failures.length} agents failed: ${visible}${remaining}. Use the retry controls to try again.`;
}

/** A run row already normalized by the agents catalog (see normalizeAgentRunRow). */
export interface PersistedAgentRun {
  agentType: string;
  agentName: string;
  messageId: string;
  success: boolean;
  error: string | null;
  createdAt: string;
}

function runTime(run: PersistedAgentRun): number {
  const time = Date.parse(run.createdAt);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/**
 * Failures still standing for the chat's latest agent turn, rebuilt from persisted runs.
 * Only runs for the newest run's message count, and per agent only its newest run there,
 * so a later successful retry clears an earlier failure.
 */
export function latestTurnAgentFailures(runs: readonly PersistedAgentRun[]): AgentFailure[] {
  const valid = runs.filter((run) => run.agentType.trim() && run.messageId.trim());
  if (valid.length === 0) return [];
  const newest = valid.reduce((latest, run) => (runTime(run) > runTime(latest) ? run : latest));
  const latestByType = new Map<string, PersistedAgentRun>();
  for (const run of valid) {
    if (run.messageId !== newest.messageId) continue;
    const current = latestByType.get(run.agentType);
    if (!current || runTime(run) >= runTime(current)) latestByType.set(run.agentType, run);
  }
  return [...latestByType.values()]
    .filter((run) => !run.success)
    .map((run) => toAgentFailure({ agentType: run.agentType, agentName: run.agentName, error: run.error }));
}
