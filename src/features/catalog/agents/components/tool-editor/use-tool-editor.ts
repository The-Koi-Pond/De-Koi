import { useQueryClient } from "@tanstack/react-query";
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

/** The custom tools list query (`useCustomTools`), which create and update refresh on success. */
const TOOL_LIST_KEY = ["custom-tools"] as const;

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
  const queryClient = useQueryClient();

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
  /** The tool whose save is running; its own list refresh is taken in when the save finishes. */
  const [pendingSaveId, setPendingSaveId] = useState<string | null>(null);
  /** Counts edits, so a save can tell whether the form changed while it ran. */
  const editCount = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset the form whenever the open id changes (also to a missing one, so abandoned edits never come
  // back) or the list hands over a changed copy of this row (a save refreshes the list; an unchanged
  // refresh keeps the same object and so keeps unsaved edits). Done while rendering so no frame shows
  // the previous tool. The unsaved bar goes too: nothing is unsaved after a reset.
  const sameTool = loaded !== null && loaded.id === toolDetailId;
  const savingThisTool = sameTool && pendingSaveId === toolDetailId;
  if ((loaded === null || !sameTool || loaded.row !== row) && !savingThisTool) {
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
    editCount.current += 1;
  }, []);

  function flashSaved() {
    clearTimeout(savedTimer.current);
    setSaved(true);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }

  /** Waits for the list refresh a save started, without starting another one. */
  async function listRefreshed() {
    if (queryClient.getQueryState(TOOL_LIST_KEY)?.fetchStatus === "fetching") {
      await queryClient.refetchQueries({ queryKey: TOOL_LIST_KEY, exact: true }, { cancelRefetch: false });
    }
  }

  function listedRow(id: string): CustomToolRow | undefined {
    return queryClient.getQueryData<CustomToolRow[]>(TOOL_LIST_KEY)?.find((tool) => tool.id === id);
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
    const savedId = toolDetailId;
    const editsAtStart = editCount.current;
    // Another tool (or New) opened while the save ran: leave that tool's form and state alone.
    const stillOpen = () => useUIStore.getState().toolDetailId === savedId;
    // Edits made while the save ran stay, unsaved, instead of being replaced by the saved row.
    const editedMeanwhile = () => editCount.current !== editsAtStart;
    setSaving(true);
    setPendingSaveId(savedId);
    try {
      const payload = toolSavePayload(form);
      if (isNew) {
        const id = storedRowId(await createTool.mutateAsync(payload));
        await listRefreshed();
        if (!stillOpen()) return true;
        if (id) {
          // Opening the stored tool reloads the form, unless the edits made meanwhile should stay.
          if (editedMeanwhile()) setLoaded({ id, row: listedRow(id) });
          openToolDetail(id);
        }
      } else {
        const stored: unknown = await updateTool.mutateAsync({ id: savedId, ...payload });
        await listRefreshed();
        if (!stillOpen()) return true;
        const listed = listedRow(savedId);
        setLoaded({ id: savedId, row: listed });
        // The form reloads from the saved row, also when nothing changed, so rows without a name drop out.
        if (!editedMeanwhile()) {
          setForm(toolFormFromRow(listed ?? (isToolRow(stored) ? stored : ({ ...row, ...payload } as CustomToolRow))));
        }
      }
      if (!editedMeanwhile()) {
        setDirty(false);
        setLeaving(false);
      }
      flashSaved();
      return true;
    } catch (error) {
      if (stillOpen()) setSaveError(error instanceof Error ? error.message : "Failed to save tool");
      return false;
    } finally {
      setSaving(false);
      setPendingSaveId(null);
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
