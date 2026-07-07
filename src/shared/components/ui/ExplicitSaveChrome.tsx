import { AlertCircle, AlertTriangle, Check, Loader2, X } from "lucide-react";

type EditorSaveStatusProps = {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
};

export function EditorSaveStatus({ dirty, saving, saved, error }: EditorSaveStatusProps) {
  if (error) {
    return (
      <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-red-400">
        <AlertCircle size="0.6875rem" /> Save failed
      </span>
    );
  }

  if (saving) {
    return (
      <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
        <Loader2 size="0.6875rem" className="animate-spin" /> Saving
      </span>
    );
  }

  if (saved && !dirty) {
    return (
      <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-emerald-400">
        <Check size="0.6875rem" /> Saved
      </span>
    );
  }

  if (dirty) {
    return <span className="mr-2 text-[0.625rem] font-medium text-amber-400">Unsaved</span>;
  }

  return null;
}

type UnsavedChangesBarProps = {
  saving: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSaveAndClose: () => void | Promise<unknown>;
  discardDisabled?: boolean;
  saveDisabled?: boolean;
  message?: string;
};

export function UnsavedChangesBar({
  saving,
  onDiscard,
  onKeepEditing,
  onSaveAndClose,
  discardDisabled = false,
  saveDisabled = false,
  message = "You have unsaved changes.",
}: UnsavedChangesBarProps) {
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle size="0.8125rem" className="shrink-0" />
        <span className="truncate">{message}</span>
      </span>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onKeepEditing} className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]">
          Keep editing
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={discardDisabled}
          className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => void onSaveAndClose()}
          disabled={saving || saveDisabled}
          className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save & close
        </button>
      </div>
    </div>
  );
}

type SaveErrorBannerProps = {
  error: string | null;
  onDismiss: () => void;
};

export function SaveErrorBanner({ error, onDismiss }: SaveErrorBannerProps) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 text-xs text-red-400">
      <AlertCircle size="0.8125rem" />
      <span className="flex-1">{error}</span>
      <button type="button" onClick={onDismiss} className="rounded-lg px-2 py-0.5 hover:bg-red-500/20">
        <X size="0.75rem" />
      </button>
    </div>
  );
}
