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
  | { mode: "conversation" | "roleplay" | "fanfic"; state: "error" }
  | { mode: "conversation" | "roleplay" | "fanfic"; state: "empty"; hasFilters: boolean };

const EMPTY_NOUNS: Record<ChatSidebarRecoveryContext["mode"], { plural: string; singular: string; create: string }> = {
  conversation: { plural: "conversations", singular: "conversation", create: "New Conversation" },
  roleplay: { plural: "roleplays", singular: "roleplay", create: "New Roleplay" },
  fanfic: { plural: "fics", singular: "fic", create: "New Fanfic" },
};

const RETRY = { id: "retry", label: "Retry" } as const;
const VIEW_HEALTH = { id: "view-health", label: "View Health" } as const;

// Codes the remote runtime adapter puts on a failure to reach or use the De-Koi server. Their messages already
// name the fix (start the server, wait, trust this address), so the sidebar shows them as they are.
const SERVER_PROBLEM_CODES = new Set([
  "remote_runtime_unreachable",
  "remote_runtime_timeout",
  "rate_limited",
  "remote_auth_required",
  "csrf_origin_not_trusted",
  "csrf_referer_not_trusted",
  "csrf_cross_site",
]);

/** A failure to reach or use the De-Koi server, with its user-facing message; null for anything else. */
function serverProblem(error: unknown): { kind: "missing-runtime" | "unhealthy-runtime"; message: string } | null {
  if (!(error instanceof Error) || error.name !== "ApiError") return null;
  const { status, details } = error as Error & { status?: unknown; details?: unknown };
  const code =
    typeof details === "object" && details !== null && typeof (details as { code?: unknown }).code === "string"
      ? (details as { code: string }).code
      : "";
  if (code === "remote_runtime_unconfigured") return { kind: "missing-runtime", message: error.message };
  const gatewayDown = typeof status === "number" && status >= 502 && status <= 504;
  return SERVER_PROBLEM_CODES.has(code) || gatewayDown ? { kind: "unhealthy-runtime", message: error.message } : null;
}

/** Shown under the loading rows while the chat list keeps retrying, so a slow or missing server isn't a silent wait. */
export function chatSidebarRetryNote(failureReason: unknown): string {
  const problem = serverProblem(failureReason);
  return problem ? `Still trying to load chats. ${problem.message}` : "Still trying to load chats…";
}

function isKnownRecoveryError(error: unknown): error is ChatSidebarRecoveryError {
  if (typeof error !== "object" || error === null || !("kind" in error)) return false;
  return ["startup", "missing-runtime", "unhealthy-runtime", "storage", "connection"].includes(String(error.kind));
}

function emptyRecovery(context: Extract<ChatSidebarRecoveryContext, { state: "empty" }>): ChatSidebarRecovery {
  const nouns = EMPTY_NOUNS[context.mode];
  const noun = nouns.plural;
  if (context.hasFilters) {
    return {
      title: `No matching ${noun}`,
      description: "Try clearing the current search and tag filters.",
      primaryAction: { id: "clear-filters", label: "Clear filters" },
    };
  }

  return {
    title: `No ${noun} yet`,
    description: `Create your first ${nouns.singular}.`,
    primaryAction: { id: "create", label: nouns.create },
  };
}

export function getChatSidebarRecovery(error: unknown, context: ChatSidebarRecoveryContext): ChatSidebarRecovery {
  if (context.state === "empty") return emptyRecovery(context);

  const problem = isKnownRecoveryError(error) ? null : serverProblem(error);
  if (problem?.kind === "unhealthy-runtime") {
    return {
      title: "Can't load chats from the De-Koi server",
      description: problem.message,
      primaryAction: RETRY,
      secondaryAction: VIEW_HEALTH,
    };
  }
  if (problem?.kind === "missing-runtime") error = { kind: "missing-runtime" };

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
