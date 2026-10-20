import { toUserMessage } from "../../../../../shared/lib/error-message";

/** Shared copy for the chat composers (roleplay ChatInput and ConversationInput), so both say the same thing. */

export function attachmentTooLargeMessage(name: string): string {
  return `${name || "That file"} is over 20 MB. Attach a smaller file.`;
}

export function attachmentUnreadableMessage(name: string): string {
  return `Couldn't read ${name || "that file"}. Try attaching it again, or use a different file.`;
}

export function translationFallbackMessage(action: "sent" | "posted"): string {
  return `Couldn't translate your message, so the original was ${action}. Check Translation in this chat's settings.`;
}

/**
 * Why a message didn't send, and what to do. `restored` says the text went back into the box; `savedDataMayRemain`
 * says part of it may already be in the chat, so sending again could duplicate it.
 */
export function sendFailureMessage(
  error: unknown,
  { action, restored, savedDataMayRemain }: { action: "send" | "post"; restored: boolean; savedDataMayRemain: boolean },
): string {
  const reason = toUserMessage(error, { fallback: `Couldn't ${action} your message. Try again.` });
  const restoredNote = restored ? " Your text is back in the message box." : "";
  const duplicateNote = savedDataMayRemain
    ? " Part of it may already be in the chat, so check before sending again."
    : "";
  return `${reason}${restoredNote}${duplicateNote}`;
}

/** A slash command or quick reply that failed for a reason other than its reply (the reply reports its own). */
export function commandFailureMessage(error: unknown, fallback = "That command didn't work"): string {
  return toUserMessage(error, { fallback: `${fallback.replace(/[.!]+$/, "")}. Try again.` });
}
