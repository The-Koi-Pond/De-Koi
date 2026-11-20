import { useCallback, useEffect, useRef, useState } from "react";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  useCreateCustomTool,
  useCustomTools,
  useDeleteCustomTool,
  useUpdateCustomTool,
  type CustomToolRow,
} from "../../hooks/use-custom-tools";
import {
  NEW_TOOL_ID,
  newToolForm,
  toolFormFromRow,
  toolFormProblem,
  toolSavePayload,
  type ToolForm,
} from "./tool-form";

const SAVED_FLASH_MS = 1500;

/** What the form was last reset for: the open id and the copy of its row (none for a new or missing tool). */
interface LoadedSource {
  id: string | null;
  row: CustomToolRow | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storedRowId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}

function isToolRow(value: unknown): value is CustomToolRow {
  return storedRowId(value) !== null;
}

export function useToolEditor() {
  const toolDetailId = useUIStore((state) => state.toolDetailId);
  const openToolDetail = useUIStore((state) => state.openToolDetail);
  const closeToolDetail = useUIStore((state) => state.closeToolDetail);
  const setEditorDirty = useUIStore((state) => state.setEditorDirty);
  const { data: tools } = useCustomTools();
  const createTool = useCreateCustomTool();
  const updateTool = useUpdateCustomTool();
  const deleteTool = useDeleteCustomTool();

  const isNew = toolDetailId === NEW_TOOL_ID;
  const row = isNew || !toolDetailId ? undefined : tools?.find((tool) => tool.id === toolDetailId);
  const found = isNew || row !== undefined;

  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [form, setForm] = useState<ToolForm>(newToolForm);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset the form whenever the open id changes (also to a missing one, so abandoned edits never come
  // back) or the list hands over a changed copy of this row (a save refreshes the list; an unchanged
  // refresh keeps the same object and so keeps unsaved edits). Done while rendering so no frame shows
  // the previous tool. The unsaved bar goes too: nothing is unsaved after a reset.
  if (loaded === null || loaded.id !== toolDetailId || loaded.row !== row) {
    setLoaded({ id: toolDetailId, row });
    setForm(row ? toolFormFromRow(row) : newToolForm());
    setDirty(false);
    setSaveError(null);
    setDeleteError(null);
    setLeaving(false);
  }

  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /** Every edit marks the form unsaved, even one that puts a value back. */
  const edit = useCallback((change: (current: ToolForm) => Partial<ToolForm>) => {
    setForm((current) => ({ ...current, ...change(current) }));
    setDirty(true);
  }, []);

  function flashSaved() {
    clearTimeout(savedTimer.current);
    setSaved(true);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }

  async function save(): Promise<boolean> {
    if (!toolDetailId) return false;
    setSaveError(null);
    setDeleteError(null);
    const problem = toolFormProblem(form);
    if (problem) {
      setSaveError(problem);
      return false;
    }
    setSaving(true);
    try {
      const payload = toolSavePayload(form);
      if (isNew) {
        const id = storedRowId(await createTool.mutateAsync(payload));
        if (id) openToolDetail(id);
      } else {
        const stored: unknown = await updateTool.mutateAsync({ id: toolDetailId, ...payload });
        // The form reloads from the stored row the save returned, also when nothing changed, so rows
        // without a name drop out. (A list refresh with a changed row then reloads it again.)
        setForm(toolFormFromRow(isToolRow(stored) ? stored : ({ ...row, ...payload } as CustomToolRow)));
      }
      setDirty(false);
      setLeaving(false);
      flashSaved();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save tool");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    // On a failure the editor stays open with the error and the unsaved bar.
    if (await save()) closeToolDetail();
  }

  async function remove() {
    if (!toolDetailId || isNew) return;
    const confirmed = await showConfirmDialog({
      title: "Delete Tool",
      message: "Delete this custom tool? This cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    setDeleteError(null);
    try {
      await deleteTool.mutateAsync(toolDetailId);
      closeToolDetail();
    } catch (error) {
      setDeleteError(`Couldn't delete: ${errorText(error)}`);
    }
  }

  function back() {
    if (dirty) setLeaving(true);
    else closeToolDetail();
  }

  function dismissError() {
    setSaveError(null);
    setDeleteError(null);
  }

  return {
    found,
    isStored: !isNew,
    showScriptWarning: row?.executionType === "script",
    form,
    edit,
    dirty,
    saving,
    saved,
    saveError,
    // A failed delete shows in the banner but isn't a save, so the header's save status ignores it.
    bannerError: deleteError ?? saveError,
    leaving,
    save,
    saveAndClose,
    remove,
    back,
    keepEditing: () => setLeaving(false),
    discard: closeToolDetail,
    dismissError,
  };
}

export type ToolEditorModel = ReturnType<typeof useToolEditor>;
