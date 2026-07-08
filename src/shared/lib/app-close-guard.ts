import { closeDesktopWindow } from "../api/window-controls-api";
import { showConfirmDialog } from "./app-dialogs";

export type AppCloseGuard = {
  label: string;
  hasPendingWork: () => boolean;
  flush?: () => void | Promise<void>;
  message?: string;
};

let nextGuardId = 1;
let closeInProgress = false;
const closeGuards = new Map<number, AppCloseGuard>();

function pendingGuards() {
  return [...closeGuards.values()].filter((guard) => {
    try {
      return guard.hasPendingWork();
    } catch {
      return true;
    }
  });
}

export function hasPendingAppCloseWork() {
  return pendingGuards().length > 0;
}

function formatGuardList(guards: readonly AppCloseGuard[]) {
  const labels = guards.map((guard) => guard.label).filter(Boolean);
  if (labels.length === 0) return "Some work has not been saved yet.";
  if (labels.length === 1) return `${labels[0]} has not been saved yet.`;
  return `Unsaved work remains in: ${labels.slice(0, 4).join(", ")}${labels.length > 4 ? ", ..." : ""}.`;
}

export function registerAppCloseGuard(guard: AppCloseGuard) {
  const id = nextGuardId++;
  closeGuards.set(id, guard);
  return () => {
    closeGuards.delete(id);
  };
}

export async function confirmDiscardPendingAppWork(options?: {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  for (const guard of pendingGuards()) {
    if (guard.flush) await guard.flush();
  }
  const remaining = pendingGuards();
  if (remaining.length === 0) return true;
  return showConfirmDialog({
    title: options?.title ?? "Leave this work?",
    message:
      remaining.find((guard) => guard.message)?.message ??
      `${formatGuardList(remaining)} Continue anyway and discard the unsaved work?`,
    confirmLabel: options?.confirmLabel ?? "Discard",
    cancelLabel: options?.cancelLabel ?? "Keep working",
    tone: "destructive",
  });
}

export async function requestGuardedAppClose() {
  if (closeInProgress) return false;
  closeInProgress = true;
  try {
    const confirmed = await confirmDiscardPendingAppWork({
      title: "Close De-Koi?",
      confirmLabel: "Close anyway",
    });
    if (!confirmed) return false;
    await closeDesktopWindow({ force: true });
    return true;
  } finally {
    closeInProgress = false;
  }
}