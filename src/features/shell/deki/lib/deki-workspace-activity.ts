import type {
  DekiWorkspacePendingApproval,
  DekiWorkspacePromptEvent,
  DekiWorkspaceToolName,
  DekiWorkspaceTraceItem,
} from "../../../../engine/deki/deki-entry";

export type DekiActivityStep = {
  id: string;
  name: DekiWorkspaceToolName;
  label: string;
  status: "running" | "done" | "error";
  output?: string;
};

export type DekiLiveActivity = {
  narration: string | null;
  retrying: boolean;
  steps: DekiActivityStep[];
  approvals: DekiWorkspacePendingApproval[];
};

export const EMPTY_DEKI_LIVE_ACTIVITY: DekiLiveActivity = {
  narration: null,
  retrying: false,
  steps: [],
  approvals: [],
};

/** Folds one live workspace event into the activity shown while Deki works. */
export function reduceDekiLiveActivity(state: DekiLiveActivity, event: DekiWorkspacePromptEvent): DekiLiveActivity {
  switch (event.type) {
    case "status": {
      const status = typeof event.data === "string" ? { content: event.data } : event.data;
      if (status.kind === "retry") return { ...state, retrying: true };
      return { ...state, narration: status.content, retrying: false };
    }
    case "tool_start": {
      const id = event.data.id ?? `step-${state.steps.length + 1}`;
      const step: DekiActivityStep = {
        id,
        name: event.data.name,
        label: describeDekiStep(event.data.name, event.data.input),
        status: "running",
      };
      return { ...state, retrying: false, steps: [...state.steps.filter((item) => item.id !== id), step] };
    }
    case "tool_end": {
      const index = event.data.id
        ? state.steps.findIndex((step) => step.id === event.data.id)
        : lastRunningStepIndex(state.steps);
      if (index < 0) return state;
      const steps = state.steps.slice();
      steps[index] = {
        ...steps[index]!,
        status: event.data.isError ? "error" : "done",
        ...(event.data.output !== undefined ? { output: event.data.output } : {}),
      };
      return { ...state, steps };
    }
    case "approval_pending":
      return state.approvals.some((approval) => approval.id === event.data.id)
        ? state
        : { ...state, approvals: [...state.approvals, event.data] };
    default:
      return state;
  }
}

function lastRunningStepIndex(steps: readonly DekiActivityStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]!.status === "running") return index;
  }
  return -1;
}

/** Steps from a finished turn's persisted trace, for the "what Deki checked" disclosure. */
export function dekiTraceSteps(trace: readonly DekiWorkspaceTraceItem[] | undefined): DekiActivityStep[] {
  return (trace ?? []).flatMap((item) => {
    if (item.type !== "tool") return [];
    return [
      {
        id: item.tool.id,
        name: item.tool.name,
        label: describeDekiStep(item.tool.name, item.tool.input),
        // A persisted step can only be running if its turn ended mid-command.
        status: item.tool.status === "error" ? "error" : "done",
        ...(typeof item.tool.output === "string" ? { output: item.tool.output } : {}),
      } satisfies DekiActivityStep,
    ];
  });
}

function text(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function quoted(value: string): string {
  const short = value.length > 60 ? `${value.slice(0, 57)}...` : value;
  return `"${short}"`;
}

function inPath(input: unknown): string {
  const path = text(input, "path");
  return path ? ` in ${path}` : "";
}

const SINGULAR_COLLECTIONS: Record<string, string> = {
  characters: "character",
  "character-groups": "character group",
  personas: "persona",
  "persona-groups": "persona group",
  lorebooks: "lorebook",
  "lorebook-entries": "lorebook entry",
  prompts: "prompt preset",
  "prompt-sections": "prompt section",
  "prompt-groups": "prompt group",
  "prompt-variables": "prompt variable",
};

function collectionLabel(value: string | null): string {
  return (value ?? "library").replace(/[-_]+/g, " ");
}

function recordLabel(value: string | null): string {
  if (!value) return "record";
  return SINGULAR_COLLECTIONS[value] ?? collectionLabel(value);
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** A short, plain-language description of one Deki command. */
export function describeDekiStep(name: DekiWorkspaceToolName, input: unknown): string {
  const query = text(input, "query") ?? text(input, "pattern");
  const path = text(input, "path");
  switch (name) {
    case "grep":
    case "search_deki_code":
      return query ? `Searched code for ${quoted(query)}${inPath(input)}` : `Searched code${inPath(input)}`;
    case "read":
    case "read_deki_code_file":
      return path ? `Read ${path}` : "Read a file";
    case "find":
      return query ? `Found files matching ${quoted(query)}${inPath(input)}` : "Found files";
    case "ls":
      return path ? `Listed ${path}` : "Listed the repository";
    case "deki_code":
      return query ? `Searched code for ${quoted(query)}${inPath(input)}` : path ? `Read ${path}` : "Checked code";
    case "read_deki_library": {
      const kind = text(input, "itemType") ?? text(input, "types");
      const scope = kind ? collectionLabel(kind) : "library";
      return query ? `Searched the ${scope} for ${quoted(query)}` : `Browsed the ${scope}`;
    }
    case "read_deki_library_items":
      return `Opened ${collectionLabel(text(input, "itemType"))} ${text(input, "id") ?? "record"}`;
    case "deki_data":
      return describeDataStep(input);
    case "read_deki_chats":
      return "Listed approved chats";
    case "read_deki_chat_messages":
      return "Read approved chat messages";
    case "read_deki_memories":
      return `Read ${text(input, "scopeType") ?? "scoped"} memories`;
    case "search_deki_web":
      return query ? `Searched the web for ${quoted(query)}` : "Searched the web";
    case "read_deki_web_page":
      return `Read ${hostOf(text(input, "url")) ?? "a web page"}`;
  }
}

function describeDataStep(input: unknown): string {
  const collection = collectionLabel(text(input, "collection"));
  const record = recordLabel(text(input, "collection"));
  const id = text(input, "id");
  switch (text(input, "action")) {
    case "status":
      return "Checked library status";
    case "collections":
      return "Checked library collections";
    case "list":
      return `Listed ${collection}`;
    case "search": {
      const query = text(input, "query");
      return query ? `Searched the library for ${quoted(query)}` : "Searched the library";
    }
    case "get":
      return `Opened ${record}${id ? ` ${id}` : ""}`;
    case "insert":
      return `Drafted a new ${record} for approval`;
    case "patch":
      return `Drafted an edit to ${record}${id ? ` ${id}` : ""} for approval`;
    case "delete":
      return `Drafted deleting ${record}${id ? ` ${id}` : ""} for approval`;
    default:
      return "Checked library data";
  }
}
