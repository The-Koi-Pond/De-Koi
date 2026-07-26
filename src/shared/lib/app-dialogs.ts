import {
  useDialogStore,
  type AlertDialogState,
  type AppDialogState,
  type ConfirmDialogState,
  type ConfirmOptionDialogState,
  type PromptDialogState,
} from "../stores/dialog.store";

export type ConfirmDialogWithOptionResult = {
  confirmed: boolean;
  optionChecked: boolean;
};

type DialogResolution = boolean | string | null | void | ConfirmDialogWithOptionResult;

type ActiveDialogResolver = {
  kind: AppDialogState["kind"];
  resolve: (value: DialogResolution) => void;
};

let activeResolver: ActiveDialogResolver | null = null;

function resolveFallback(kind: AppDialogState["kind"]) {
  if (kind === "confirm") return false;
  if (kind === "confirm-option") return { confirmed: false, optionChecked: false };
  if (kind === "prompt") return null;
  return undefined;
}

function openDialog<T extends DialogResolution>(dialog: AppDialogState): Promise<T> {
  if (activeResolver) {
    activeResolver.resolve(resolveFallback(activeResolver.kind));
    activeResolver = null;
  }

  useDialogStore.getState().openDialog(dialog);

  return new Promise<T>((resolve) => {
    activeResolver = {
      kind: dialog.kind,
      resolve: resolve as (value: DialogResolution) => void,
    };
  });
}

export function resolveActiveDialog(value: DialogResolution) {
  const resolver = activeResolver;
  activeResolver = null;
  useDialogStore.getState().closeDialog();
  resolver?.resolve(value);
}

export function dismissActiveDialog() {
  const dialog = useDialogStore.getState().dialog;
  if (!dialog) return;
  resolveActiveDialog(resolveFallback(dialog.kind));
}

export function showAlertDialog(options: Omit<AlertDialogState, "kind">): Promise<void> {
  return openDialog<void>({
    kind: "alert",
    confirmLabel: "OK",
    ...options,
  });
}

export function showConfirmDialog(options: Omit<ConfirmDialogState, "kind">): Promise<boolean> {
  return openDialog<boolean>({
    kind: "confirm",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    ...options,
  });
}

export function showConfirmDialogWithOption(
  options: Omit<ConfirmOptionDialogState, "kind">,
): Promise<ConfirmDialogWithOptionResult> {
  return openDialog<ConfirmDialogWithOptionResult>({
    kind: "confirm-option",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    defaultChecked: false,
    ...options,
  });
}

export function showPromptDialog(options: Omit<PromptDialogState, "kind">): Promise<string | null> {
  return openDialog<string | null>({
    kind: "prompt",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    ...options,
  });
}
