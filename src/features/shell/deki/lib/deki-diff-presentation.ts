import type { DekiActionDiffPart, DekiActionDiffRow } from "./deki-action-diff";

/**
 * How one generic Deki diff row should be shown. This is presentation only:
 * the diff rows and the Deki action contract stay generic, and this layer
 * picks a format that matches the value's shape.
 */
export type DekiDiffPresentation =
  | { kind: "scalar"; before: string | null; after: string }
  | { kind: "state"; before: string | null; after: string }
  | { kind: "color"; before: string | null; after: string }
  | { kind: "list"; added: string[]; removed: string[]; kept: string[] }
  | { kind: "prose"; parts: DekiActionDiffPart[]; collapsible: boolean };

const SCALAR_MAX_CHARS = 80;
const PROSE_COLLAPSE_CHARS = 420;
const LIST_ITEM_MAX_CHARS = 60;
const STATE_FIELDS = new Set(["role", "position", "mode", "type", "status", "selectiveLogic", "strategy"]);
const COLOR_PATTERN = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^()]{5,40}\)|hsla?\([^()]{5,40}\))$/i;

const FIELD_LABELS: Record<string, string> = {
  first_mes: "First message",
  mes_example: "Example dialogue",
  creator_notes: "Creator notes",
  system_prompt: "System prompt",
  post_history_instructions: "Post-history instructions",
  alternate_greetings: "Alternate greetings",
  character_version: "Character version",
  character_book: "Character lorebook",
  depth_prompt: "Depth prompt",
  publicProfile: "Public profile",
  keys: "Activation keys",
  secondaryKeys: "Secondary keys",
  selectiveLogic: "Selective logic",
  scanDepth: "Scan depth",
  insertionOrder: "Insertion order",
  variableName: "Variable name",
};

function fieldName(path: string): string {
  return (
    path
      .split(".")
      .filter((segment) => segment !== "data" && segment !== "extensions")
      .at(-1) ?? path
  );
}

/** A reader-facing label for a diff path, e.g. `data.first_mes` -> "First message". */
export function dekiDiffFieldLabel(path: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const field = fieldName(path);
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function listItems(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isPrimitive)) return null;
  return value.map((item) => String(item));
}

function shortScalar(value: unknown): value is string | number {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= SCALAR_MAX_CHARS && !value.includes("\n"))
  );
}

function scalarText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function stateText(value: unknown): string | null {
  if (value === true) return "On";
  if (value === false) return "Off";
  return scalarText(value);
}

/**
 * Multiset list diff: each occurrence is matched once, so dropping one of two
 * repeated tags shows as a removal and adding a repeat shows as an addition.
 */
function diffListItems(
  beforeItems: string[],
  afterItems: string[],
): { added: string[]; removed: string[]; kept: string[] } {
  const unmatched = new Map<string, number>();
  for (const item of beforeItems) unmatched.set(item, (unmatched.get(item) ?? 0) + 1);
  const added: string[] = [];
  const kept: string[] = [];
  for (const item of afterItems) {
    const remaining = unmatched.get(item) ?? 0;
    if (remaining > 0) {
      unmatched.set(item, remaining - 1);
      kept.push(item);
    } else {
      added.push(item);
    }
  }
  const removed: string[] = [];
  for (const item of beforeItems) {
    const remaining = unmatched.get(item) ?? 0;
    if (remaining > 0) {
      unmatched.set(item, remaining - 1);
      removed.push(item);
    }
  }
  return { added, removed, kept };
}

export function presentDekiDiffRow(row: DekiActionDiffRow): DekiDiffPresentation {
  const before = row.beforeValue;
  const after = row.afterValue;
  const create = row.status === "added";

  const beforeItems = create ? [] : listItems(before);
  const afterItems = listItems(after);
  if (
    beforeItems &&
    afterItems &&
    (Array.isArray(after) || Array.isArray(before)) &&
    [...beforeItems, ...afterItems].every((item) => item.length <= LIST_ITEM_MAX_CHARS)
  ) {
    return { kind: "list", ...diffListItems(beforeItems, afterItems) };
  }

  const bothOptional = (check: (value: unknown) => boolean) =>
    check(after) && (create || before === undefined || before === null || check(before));

  if (bothOptional((value) => typeof value === "boolean")) {
    return { kind: "state", before: create ? null : stateText(before), after: stateText(after) ?? "" };
  }
  if (bothOptional((value) => typeof value === "string" && COLOR_PATTERN.test(value.trim()))) {
    return { kind: "color", before: create ? null : scalarText(before), after: String(after).trim() };
  }
  if (STATE_FIELDS.has(fieldName(row.path)) && bothOptional(shortScalar)) {
    return { kind: "state", before: create ? null : scalarText(before), after: scalarText(after) ?? "" };
  }
  if (bothOptional(shortScalar)) {
    return { kind: "scalar", before: create ? null : scalarText(before), after: scalarText(after) ?? "" };
  }

  const parts = create ? (row.after ? [{ text: row.after, kind: "added" as const }] : []) : row.inlineDiff;
  const length = Math.max(row.after.length, row.before?.length ?? 0);
  return { kind: "prose", parts, collapsible: length > PROSE_COLLAPSE_CHARS };
}

const READING_ORDER: Record<DekiDiffPresentation["kind"], number> = {
  scalar: 0,
  state: 0,
  color: 0,
  list: 1,
  prose: 2,
};

/**
 * Orders rows so quick facts (names, toggles, colors, tags) come before long
 * prose, keeping the original order within each group.
 */
export function orderDekiDiffRowsForReading<T extends DekiActionDiffRow>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, rank: READING_ORDER[presentDekiDiffRow(row).kind] }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ row }) => row);
}
