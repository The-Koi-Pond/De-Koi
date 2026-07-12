export type ChatSidebarRecoveryActionId =
  | "retry"
  | "connect-server"
  | "open-connections"
  | "view-health"
  | "copy-support-details"
  | "clear-filters"
  | "create";

type ChatSidebarRecoveryAction = {
  id: ChatSidebarRecoveryActionId;
  label: string;
};

export type ChatSidebarRecovery = {
  title: string;
  description: string;
  primaryAction: ChatSidebarRecoveryAction;
  secondaryAction?: ChatSidebarRecoveryAction;
};

type ChatSidebarRecoveryError = {
  kind: "startup" | "missing-runtime" | "unhealthy-runtime" | "storage" | "connection";
};

export type ChatSidebarRecoveryContext =
  | { mode: "conversation" | "roleplay" | "game"; state: "error" }
  | { mode: "conversation" | "roleplay" | "game"; state: "empty"; hasFilters: boolean };

const RETRY = { id: "retry", label: "Retry" } as const;
const VIEW_HEALTH = { id: "view-health", label: "View Health" } as const;

function isKnownRecoveryError(error: unknown): error is ChatSidebarRecoveryError {
  if (typeof error !== "object" || error === null || !("kind" in error)) return false;
  return ["startup", "missing-runtime", "unhealthy-runtime", "storage", "connection"].includes(
    String(error.kind),
  );
}

function emptyRecovery(context: Extract<ChatSidebarRecoveryContext, { state: "empty" }>): ChatSidebarRecovery {
  const noun = context.mode === "conversation" ? "conversations" : context.mode === "roleplay" ? "roleplays" : "games";
  if (context.hasFilters) {
    return {
      title: `No matching ${noun}`,
      description: "Try clearing the current search and tag filters.",
      primaryAction: { id: "clear-filters", label: "Clear filters" },
    };
  }

  const label = context.mode === "conversation" ? "New Conversation" : context.mode === "roleplay" ? "New Roleplay" : "New Game";
  return {
    title: `No ${noun} yet`,
    description: `Create your first ${context.mode === "conversation" ? "conversation" : context.mode}.`,
    primaryAction: { id: "create", label },
  };
}

export function getChatSidebarRecovery(error: unknown, context: ChatSidebarRecoveryContext): ChatSidebarRecovery {
  if (context.state === "empty") return emptyRecovery(context);

  if (!isKnownRecoveryError(error)) {
    return {
      title: "Chats could not be loaded",
      description: "Retry the request or open Health for diagnostics and support details.",
      primaryAction: RETRY,
      secondaryAction: VIEW_HEALTH,
    };
  }

  switch (error.kind) {
    case "startup":
      return {
        title: "Chat history is not ready",
        description: "De-Koi could not finish loading chat history during startup.",
        primaryAction: RETRY,
        secondaryAction: VIEW_HEALTH,
      };
    case "missing-runtime":
      return {
        title: "Connect a De-Koi server",
        description: "This web session needs a server before it can load chat history.",
        primaryAction: { id: "connect-server", label: "Connect server" },
        secondaryAction: VIEW_HEALTH,
      };
    case "unhealthy-runtime":
      return {
        title: "The De-Koi server needs attention",
        description: "Open Health to check runtime reachability and write access.",
        primaryAction: VIEW_HEALTH,
        secondaryAction: RETRY,
      };
    case "storage":
      return {
        title: "Chat storage is unavailable",
        description: "Open Health to check storage access and collect safe support details.",
        primaryAction: VIEW_HEALTH,
        secondaryAction: { id: "copy-support-details", label: "Copy support details" },
      };
    case "connection":
      return {
        title: "A model connection needs attention",
        description: "Open Connections to review the provider used by your chats.",
        primaryAction: { id: "open-connections", label: "Open Connections" },
        secondaryAction: RETRY,
      };
  }
}
