
export interface ClientDiagnosticRecord {
  id: string;
  level: "info" | "warning" | "error";
  source: string;
  message: string;
  timestamp: string;
  details?: unknown;
}

export type ClientDiagnosticInput = Omit<ClientDiagnosticRecord, "id" | "timestamp"> & {
  timestamp?: string;
};

const MAX_RECENT_DIAGNOSTICS = 30;
const recentDiagnostics: ClientDiagnosticRecord[] = [];
let diagnosticSequence = 0;

function nextDiagnosticId(): string {
  diagnosticSequence += 1;
  return `client-diagnostic-${diagnosticSequence}`;
}

export function recordClientDiagnostic(input: ClientDiagnosticInput): ClientDiagnosticRecord {
  const record: ClientDiagnosticRecord = {
    id: nextDiagnosticId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    level: input.level,
    source: input.source,
    message: input.message,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
  recentDiagnostics.unshift(record);
  if (recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS) {
    recentDiagnostics.length = MAX_RECENT_DIAGNOSTICS;
  }
  return record;
}

export function getRecentClientDiagnostics(): ClientDiagnosticRecord[] {
  return recentDiagnostics.map((record) => ({ ...record }));
}
