import { isRecord, readString } from "../../../generation/runtime-records";

/** A selfie a character sent: marked as one, or (made before the mark) a saved prompt on a `selfie_*` file. */
export function isSelfieAttachment(attachment: unknown): boolean {
  if (!isRecord(attachment) || !readString(attachment.type).startsWith("image")) return false;
  if (readString(attachment.kind) === "selfie") return true;
  return !!readString(attachment.prompt).trim() && /^selfie_/i.test(readString(attachment.filename));
}
