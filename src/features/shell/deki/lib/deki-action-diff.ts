import type { DekiEntryAction, DekiWorkspaceRowChange } from "../../../../engine/deki/deki-entry";

export type DekiActionDiffPart = {
  text: string;
  kind: "unchanged" | "added" | "removed";
};

export type DekiActionDiffRow = {
  path: string;
  before: string | null;
  after: string;
  status: "added" | "changed" | "unchanged" | "removed";
  inlineDiff: DekiActionDiffPart[];
};

type FlatValue = {
  path: string;
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function valueAtPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    const comparable = parseJsonObject(current);
    if (!isRecord(comparable)) return undefined;
    current = comparable[segment];
  }
  return current;
}

function flattenProposedValue(value: unknown, prefix = ""): FlatValue[] {
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [];
    return entries.flatMap(([key, child]) => flattenProposedValue(child, prefix ? `${prefix}.${key}` : key));
  }
  if (!prefix) return [];
  return [{ path: prefix, value }];
}

function stableFormat(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sameValue(before: unknown, after: unknown): boolean {
  return stableFormat(before) === stableFormat(after);
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_'’-]/u.test(char);
}

function inlineDiffString(before: string, after: string): DekiActionDiffPart[] {
  if (before === after) {
    return before ? [{ text: before, kind: "unchanged" }] : [];
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefixLength < maxPrefix && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  // Snap the shared prefix back to a word start so "dusk" -> "dawn" reads as
  // a whole-word change instead of "d" + "usk" -> "awn".
  while (prefixLength > 0 && isWordChar(before[prefixLength - 1]) && isWordChar(before[prefixLength])) {
    prefixLength -= 1;
  }

  let suffixLength = 0;
  const maxSuffix = Math.min(before.length - prefixLength, after.length - prefixLength);
  while (
    suffixLength < maxSuffix &&
    before[before.length - 1 - suffixLength] === after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  while (
    suffixLength > 0 &&
    isWordChar(after[after.length - suffixLength]) &&
    isWordChar(after[after.length - suffixLength - 1])
  ) {
    suffixLength -= 1;
  }

  const parts: DekiActionDiffPart[] = [
    { text: before.slice(0, prefixLength), kind: "unchanged" },
    { text: before.slice(prefixLength, before.length - suffixLength), kind: "removed" },
    { text: after.slice(prefixLength, after.length - suffixLength), kind: "added" },
    { text: after.slice(after.length - suffixLength), kind: "unchanged" },
  ];
  return parts.filter((part) => part.text.length > 0);
}

function inlineDiffForRow(
  before: string | null,
  after: string,
  status: DekiActionDiffRow["status"],
): DekiActionDiffPart[] {
  if (status === "added") return after ? [{ text: after, kind: "added" }] : [];
  if (status === "unchanged") return after ? [{ text: after, kind: "unchanged" }] : [];
  return inlineDiffString(before ?? "", after);
}

function buildDiffRow(path: string, beforeValue: unknown, afterValue: unknown, create: boolean): DekiActionDiffRow {
  const before = create ? null : stableFormat(beforeValue);
  const after = stableFormat(afterValue);
  const status = create ? "added" : sameValue(beforeValue, afterValue) ? "unchanged" : "changed";
  return {
    path,
    before,
    after,
    status,
    inlineDiff: inlineDiffForRow(before, after, status),
  };
}

const DEKI_ROW_CHANGE_HIDDEN_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

/**
 * Diff rows for one row of a Deki data-change preview. The runtime already
 * reduced updates to the changed fields, so every row here is a real change.
 */
export function createDekiRowChangeDiffRows(change: DekiWorkspaceRowChange): DekiActionDiffRow[] {
  const visible = (entry: FlatValue) => !DEKI_ROW_CHANGE_HIDDEN_FIELDS.has(entry.path);
  if (change.action === "delete") {
    return flattenProposedValue(change.before ?? {})
      .filter(visible)
      .map((entry) => {
        const before = stableFormat(entry.value);
        return {
          path: entry.path,
          before,
          after: "",
          status: "removed" as const,
          inlineDiff: before ? [{ text: before, kind: "removed" as const }] : [],
        };
      });
  }
  const create = change.action === "insert";
  return flattenProposedValue(change.after ?? {})
    .filter(visible)
    .map((entry) =>
      buildDiffRow(
        entry.path,
        create ? undefined : valueAtPath(change.before ?? {}, entry.path.split(".")),
        entry.value,
        create,
      ),
    );
}

export type DekiDeletePreviewField = { label: string; value: string };

const DEKI_DELETE_PREVIEW_MAX_CHARS = 280;

function readablePreviewValue(value: unknown): string {
  if (Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null)) {
    return value.map((item) => String(item)).join(", ");
  }
  return stableFormat(value);
}

/**
 * A readable summary of what a delete removes: user-facing fields only (no ids
 * or storage timestamps), lists as plain text, long text clipped.
 */
export function createDekiDeletePreviewFields(change: DekiWorkspaceRowChange): DekiDeletePreviewField[] {
  return flattenProposedValue(change.before ?? {})
    .filter((entry) => {
      const field = entry.path.split(".").at(-1) ?? entry.path;
      return !DEKI_ROW_CHANGE_HIDDEN_FIELDS.has(field) && !/(^id|Id|Ids)$/.test(field);
    })
    .map((entry) => ({ path: entry.path, value: readablePreviewValue(entry.value).trim() }))
    .filter((entry) => entry.value.length > 0)
    .map((entry) => ({
      label: entry.path,
      value:
        entry.value.length > DEKI_DELETE_PREVIEW_MAX_CHARS
          ? `${entry.value.slice(0, DEKI_DELETE_PREVIEW_MAX_CHARS - 3)}...`
          : entry.value,
    }));
}

export function createDekiActionDiffRows(
  action: DekiEntryAction,
  currentRecord?: Record<string, unknown> | null,
): DekiActionDiffRow[] {
  if (
    action.type === "none" ||
    action.type === "request_chat_access" ||
    action.type === "request_web_research" ||
    action.type === "apply_lorebook_redraft"
  )
    return [];
  const payload = action.type === "create_record" ? action.draft : action.patch;
  return flattenProposedValue(payload).map((entry) => {
    const path = entry.path.split(".");
    const before = action.type === "edit_record" ? valueAtPath(currentRecord, path) : undefined;
    return buildDiffRow(entry.path, before, entry.value, action.type === "create_record");
  });
}
