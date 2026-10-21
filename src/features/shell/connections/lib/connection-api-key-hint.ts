export interface ConnectionApiKeyHintInput {
  /** Subscription providers that read a local login instead of an API key. */
  localAuth: "claude" | "chatgpt" | "codex-image" | null;
  /** The saved connection already has a key on the server. */
  hasSavedKey: boolean;
}

/**
 * Placeholder and note for the API Key box. A brand-new connection has no key yet, so it asks for one instead of
 * offering to "keep the existing key".
 */
export function connectionApiKeyHint({ localAuth, hasSavedKey }: ConnectionApiKeyHintInput): {
  placeholder: string;
  note: string;
} {
  if (localAuth === "claude") {
    return {
      placeholder: "Not used - read from local Claude Code login",
      note: "Authentication is read from your local Claude Code session.",
    };
  }
  if (localAuth === "chatgpt") {
    return {
      placeholder: "Not used - read from local Codex ChatGPT login",
      note: "Authentication is read from your local Codex auth.json credential file; this field stays locked.",
    };
  }
  if (localAuth === "codex-image") {
    return {
      placeholder: "Not used - read from local Codex login",
      note: "Image generation is delegated to the local Codex CLI using your Codex subscription login.",
    };
  }
  if (hasSavedKey) {
    return {
      placeholder: "••••••••  (leave empty to keep existing key)",
      note: "Your key is encrypted at rest. Leave blank to keep the saved key.",
    };
  }
  return {
    placeholder: "Paste your API key here",
    note: "Your key is encrypted at rest.",
  };
}
