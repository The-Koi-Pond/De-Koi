type SendShortcutEvent = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

export function isSendShortcut(event: SendShortcutEvent, enterToSend: boolean): boolean {
  if (event.nativeEvent?.isComposing) return false;
  if (event.key !== "Enter") return false;
  if (event.shiftKey) return false;
  return enterToSend || event.ctrlKey || event.metaKey;
}

type SendShortcutEnvironment = { finePointer: boolean; apple: boolean };

function currentSendShortcutEnvironment(): SendShortcutEnvironment {
  if (typeof window === "undefined") return { finePointer: false, apple: false };
  const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
  const platform = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
  return { finePointer, apple: /Mac|iPhone|iPad/i.test(platform) };
}

/**
 * The key combo that sends when Enter only adds a new line, so the composer can say so.
 * Null when Enter already sends, or on touch-first devices where people tap the send button.
 */
export function sendShortcutHint(
  enterToSend: boolean,
  environment: SendShortcutEnvironment = currentSendShortcutEnvironment(),
): string | null {
  if (enterToSend || !environment.finePointer) return null;
  return environment.apple ? "⌘+Enter" : "Ctrl+Enter";
}
