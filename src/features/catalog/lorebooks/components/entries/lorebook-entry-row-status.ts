import type { LorebookEntry } from "../../../../../engine/contracts/types/lorebook";

/** Maps the (constant, selective) boolean pair into a single status enum for the inline select. */
export type EntryStatus = "constant" | "selective" | "normal";

export function deriveStatus(entry: LorebookEntry): EntryStatus {
  if (entry.constant) return "constant";
  if (entry.selective) return "selective";
  return "normal";
}

export function statusToFlags(status: EntryStatus): { constant: boolean; selective: boolean } {
  switch (status) {
    case "constant":
      return { constant: true, selective: false };
    case "selective":
      return { constant: false, selective: true };
    case "normal":
    default:
      return { constant: false, selective: false };
  }
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  constant: "Constant",
  selective: "Selective",
  normal: "Normal",
};

export const STATUS_DESCRIPTION: Record<EntryStatus, string> = {
  normal: "This entry is currently set to trigger normally, when key words are detected.",
  constant: "This entry is constantly injected into the context.",
  selective:
    "This entry uses selective matching: primary keys must match with the secondary-key logic below before it is injected.",
};

/** Color plus shape, so the status reads without color: normal = circle, constant = square, selective = diamond. */
export const STATUS_DOT_CLASS: Record<EntryStatus, string> = {
  constant: "bg-amber-400 rounded-[2px]",
  selective: "bg-violet-400 h-2 w-2 rotate-45 rounded-[1px]",
  normal: "bg-emerald-400",
};

const ENTRY_STATUS_ORDER: EntryStatus[] = ["normal", "constant", "selective"];

export function getNextStatus(status: EntryStatus): EntryStatus {
  const index = ENTRY_STATUS_ORDER.indexOf(status);
  return ENTRY_STATUS_ORDER[(index + 1) % ENTRY_STATUS_ORDER.length] ?? "normal";
}
