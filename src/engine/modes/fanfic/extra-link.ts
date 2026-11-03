import type { FanficExtraLink } from "../../contracts/types/fanfic";
import { isRecord, parseRecord } from "../../generation/runtime-records";

/** The first extra after main chapter N is N.5; later ones count up with no cap (N.10 follows N.9). */
export const FIRST_EXTRA_NUMBER = 5;

/**
 * A message-level `extra.fanficExtra` marker. One without a readable main chapter number makes the message a main
 * chapter; one with only an unreadable canon flag stays an extra, as a side story, so no later chapter is renumbered.
 */
export function readFanficExtraLink(extra: unknown): FanficExtraLink | null {
  const raw = parseRecord(extra).fanficExtra;
  if (!isRecord(raw)) return null;
  const parent = raw.parentChapter;
  return typeof parent === "number" && Number.isInteger(parent) && parent > 0
    ? { parentChapter: parent, canon: raw.canon === true }
    : null;
}
