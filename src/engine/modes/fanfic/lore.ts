import type { FanficRequest } from "../../contracts/types/fanfic";
import type { JsonRecord } from "../../generation/runtime-records";

/**
 * The text lorebook keywords are matched against for a fic. A fic has no user turns, so without this
 * a keyword entry could only fire once its keyword turned up in a chapter that was already written.
 * The style notes stay out: a pasted prose sample shouldn't pull in lore.
 */
export function fanficLoreScanText(request: FanficRequest, extra = ""): string {
  return [
    request.fandom,
    request.characters.join(", "),
    request.relationships.join(", "),
    request.povCharacter,
    request.tags.join(", "),
    request.settingNotes,
    request.prompt,
    extra,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/** One scan-only user turn carrying the request (plus the chapter's plan), appended after the chapters. */
export function fanficLoreScanMessages(request: FanficRequest | null | undefined, extra = ""): JsonRecord[] {
  if (!request) return [];
  const content = fanficLoreScanText(request, extra);
  return content ? [{ role: "user", content }] : [];
}
