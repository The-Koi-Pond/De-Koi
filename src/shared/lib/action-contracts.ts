import { showConfirmDialog } from "./app-dialogs";
import type { ConfirmDialogState } from "../stores/dialog.store";

export const ACTION_VERB_RULES = {
  delete: "Delete means permanent record, file, or saved data loss.",
  remove:
    "Remove means unlink, detach, exclude, or remove from a local grouping without deleting the underlying resource.",
  newCreate: "New/Create creates durable resources.",
  start: "Start begins a chat, session, or game flow.",
  generateMake: "Generate/Make means assisted creation.",
  import: "Import brings external files or data into De-Koi.",
  add: "Add creates sub-items or associations inside an existing resource.",
  saveApply: "Save is durable persistence; Apply changes active local settings without implying a new saved resource.",
} as const;

export type ActionImpact = "permanent" | "unlink" | "choice";
export type ConfirmActionKind = "delete" | "remove" | "import";

type ActionDialogOptions = {
  action: ConfirmActionKind;
  resource: string;
  name?: string;
  context?: string;
  message?: string;
};

type BuiltConfirmDialog = Omit<ConfirmDialogState, "kind">;

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function getActionVerb(impact: ActionImpact): "Delete" | "Remove" | "Import" {
  if (impact === "permanent") return "Delete";
  if (impact === "unlink") return "Remove";
  return "Import";
}

export function buildActionConfirmDialog(options: ActionDialogOptions): BuiltConfirmDialog {
  const resourceTitle = titleCase(options.resource);
  const verb = options.action === "delete" ? "Delete" : options.action === "remove" ? "Remove" : "Import";
  const quotedName = options.name ? `"${options.name}"` : `this ${options.resource}`;
  const context = options.context ? ` ${options.context}` : "";
  const message =
    options.message ??
    (options.action === "delete"
      ? `${verb} ${quotedName}? This cannot be undone.`
      : `${verb} ${quotedName}${context}?`);

  return {
    title: `${verb} ${resourceTitle}`,
    message,
    confirmLabel: verb,
    cancelLabel: "Cancel",
    tone: options.action === "delete" ? "destructive" : "default",
  };
}

export function confirmAction(options: ActionDialogOptions): Promise<boolean> {
  return showConfirmDialog(buildActionConfirmDialog(options));
}
