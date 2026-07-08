import { ApiError } from "../../../../shared/api/api-errors";

export type ConnectionReferenceSummary = {
  id?: string;
  name?: string;
  type?: string;
};

export type ConnectionDeleteBlock = {
  chats: ConnectionReferenceSummary[];
  agents: ConnectionReferenceSummary[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readReferenceRows(value: unknown): ConnectionReferenceSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    id: readString(row.id) || undefined,
    name: readString(row.name) || undefined,
    type: readString(row.type) || undefined,
  }));
}

export function connectionDeleteBlockFromError(error: unknown): ConnectionDeleteBlock | null {
  if (!(error instanceof ApiError) || !isRecord(error.details)) return null;
  if (readString(error.details.code) !== "connection_in_use") return null;
  return {
    chats: readReferenceRows(error.details.chats),
    agents: readReferenceRows(error.details.agents),
  };
}

export function formatConnectionForceDeleteFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "Delete failed";
  return `Forced delete failed. The connection may still exist; De-Koi is refreshing attached chats and agents. ${detail}`;
}

function referenceLabel(row: ConnectionReferenceSummary, fallback: string): string {
  return row.name || row.type || row.id || fallback;
}

function formatReferenceList(rows: ConnectionReferenceSummary[], limit: number, fallback: string): string[] {
  const visible = rows.slice(0, Math.max(1, limit));
  const lines = visible.map((row, index) => `- ${referenceLabel(row, `${fallback} ${index + 1}`)}`);
  const hidden = rows.length - visible.length;
  if (hidden > 0) lines.push(`- and ${hidden} more`);
  return lines;
}

export function formatConnectionDeleteBlockMessage(
  chats: ConnectionReferenceSummary[],
  limit = 6,
  agents: ConnectionReferenceSummary[] = [],
): string {
  const sections: string[] = [];
  if (chats.length > 0) {
    sections.push(
      `This connection is still attached to these chats:\n\n${formatReferenceList(chats, limit, "Chat").join("\n")}`,
    );
  }
  if (agents.length > 0) {
    sections.push(
      `This connection is also used by these agents:\n\n${formatReferenceList(agents, limit, "Agent").join("\n")}`,
    );
  }
  const intro = sections.length > 0 ? sections.join("\n\n") : "This connection is still in use.";
  return `${intro}\n\nDelete anyway? These chats will lose their connection and stop working until reassigned.`;
}
