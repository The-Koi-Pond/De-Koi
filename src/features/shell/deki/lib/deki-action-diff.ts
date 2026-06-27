import type { DekiEntryAction } from "../../../../engine/deki/deki-entry";

export type DekiActionDiffPart = {
  text: string;
  kind: "unchanged" | "added" | "removed";
};

export type DekiActionDiffRow = {
  path: string;
  before: string | null;
  after: string;
  status: "added" | "changed" | "unchanged";
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

function inlineDiffString(before: string, after: string): DekiActionDiffPart[] {
  if (before === after) {
    return before ? [{ text: before, kind: "unchanged" }] : [];
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefixLength < maxPrefix && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffix = Math.min(before.length - prefixLength, after.length - prefixLength);
  while (
    suffixLength < maxSuffix &&
    before[before.length - 1 - suffixLength] === after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const parts: DekiActionDiffPart[] = [
    { text: before.slice(0, prefixLength), kind: "unchanged" },
    { text: before.slice(prefixLength, before.length - suffixLength), kind: "removed" },
    { text: after.slice(prefixLength, after.length - suffixLength), kind: "added" },
    { text: after.slice(after.length - suffixLength), kind: "unchanged" },
  ];
  return parts.filter((part) => part.text.length > 0);
}

function inlineDiffForRow(before: string | null, after: string, status: DekiActionDiffRow["status"]): DekiActionDiffPart[] {
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

export function createDekiActionDiffRows(
  action: DekiEntryAction,
  currentRecord?: Record<string, unknown> | null,
): DekiActionDiffRow[] {
  if (action.type === "none") return [];
  const payload = action.type === "create_record" ? action.draft : action.patch;
  return flattenProposedValue(payload).map((entry) => {
    const path = entry.path.split(".");
    const before = action.type === "edit_record" ? valueAtPath(currentRecord, path) : undefined;
    return buildDiffRow(entry.path, before, entry.value, action.type === "create_record");
  });
}
