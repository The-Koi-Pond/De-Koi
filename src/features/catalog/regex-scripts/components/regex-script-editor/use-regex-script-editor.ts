import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useCharacterSummaries } from "../../../characters";
import {
  useCreateRegexScript,
  useDeleteRegexScript,
  useRegexScripts,
  useUpdateRegexScript,
  type RegexScriptRow,
} from "../../hooks/use-regex-scripts";
import { liveTestResult, regexPatternError } from "./live-test";
import {
  NEW_REGEX_SCRIPT_ID,
  newRegexScriptForm,
  regexScriptFormFromRow,
  regexScriptFormProblem,
  regexScriptSavePayload,
  type RegexScriptForm,
} from "./regex-script-form";

const SAVED_FLASH_MS = 1500;

export interface ScopeCharacter {
  id: string;
  name: string;
}

/** What the form was last filled from: a new script or one copy of a stored row. */
interface LoadedSource {
  id: string;
  row: RegexScriptRow | undefined;
}

/** The Live Test text and the script it was typed for. */
interface LiveTestState {
  scriptId: string | null;
  text: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRegexScriptEditor() {
  const regexDetailId = useUIStore((state) => state.regexDetailId);
  const openRegexDetail = useUIStore((state) => state.openRegexDetail);
  const closeRegexDetail = useUIStore((state) => state.closeRegexDetail);
  const setEditorDirty = useUIStore((state) => state.setEditorDirty);
  // The list query is read before the characters so their storage reads go out in that order.
  const { data: scripts } = useRegexScripts();
  const { data: characterSummaries } = useCharacterSummaries();
  const createScript = useCreateRegexScript();
  const updateScript = useUpdateRegexScript();
  const deleteScript = useDeleteRegexScript();

  const isNew = regexDetailId === NEW_REGEX_SCRIPT_ID;
  const row = isNew || !regexDetailId ? undefined : scripts?.find((script) => script.id === regexDetailId);
  const found = isNew || row !== undefined;

  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [form, setForm] = useState<RegexScriptForm>(newRegexScriptForm);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [liveTest, setLiveTest] = useState<LiveTestState>({ scriptId: null, text: "" });
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Refill the form whenever another script opens or the list hands over a new copy of this row
  // (a save refreshes the list). Done while rendering so no frame shows the previous script.
  if (regexDetailId && found && (loaded?.id !== regexDetailId || loaded.row !== row)) {
    setLoaded({ id: regexDetailId, row });
    setForm(row ? regexScriptFormFromRow(row) : newRegexScriptForm());
    setDirty(false);
    setSaveError(null);
    setDeleteError(null);
    setLeaving(false);
    // The Live Test text survives a reload of the same script, not a switch to another one.
    if (liveTest.scriptId !== regexDetailId) setLiveTest({ scriptId: regexDetailId, text: "" });
  }

  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const characters = useMemo<ScopeCharacter[]>(
    () =>
      (characterSummaries ?? [])
        .map((character) => ({ id: character.id, name: character.data?.name?.trim() || character.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [characterSummaries],
  );

  const patternError = useMemo(
    () => regexPatternError(form.findRegex, form.flags, liveTest.text),
    [form.findRegex, form.flags, liveTest.text],
  );

  const result = useMemo(
    () =>
      liveTest.text
        ? liveTestResult({
            liveText: liveTest.text,
            findRegex: form.findRegex,
            replaceString: form.replaceString,
            flags: form.flags,
            trimStrings: form.trimStrings,
            patternError,
          })
        : null,
    [liveTest.text, form.findRegex, form.replaceString, form.flags, form.trimStrings, patternError],
  );

  /** Every edit to a saved field marks the form unsaved. */
  const edit = useCallback((change: (current: RegexScriptForm) => Partial<RegexScriptForm>) => {
    setForm((current) => ({ ...current, ...change(current) }));
    setDirty(true);
  }, []);

  const setLiveText = useCallback((text: string) => {
    setLiveTest((current) => ({ ...current, text }));
  }, []);

  function flashSaved() {
    clearTimeout(savedTimer.current);
    setSaved(true);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }

  async function save(): Promise<boolean> {
    if (!regexDetailId) return false;
    setSaveError(null);
    const problem = regexScriptFormProblem(form);
    if (problem) {
      setSaveError(problem);
      return false;
    }
    setSaving(true);
    try {
      const payload = regexScriptSavePayload(form);
      if (isNew) {
        const created = await createScript.mutateAsync(payload);
        if (created?.id) {
          // The script just created is the one being edited, so its Live Test text stays.
          setLiveTest((current) => ({ ...current, scriptId: created.id }));
          openRegexDetail(created.id);
        }
      } else {
        await updateScript.mutateAsync({ id: regexDetailId, ...payload });
      }
      setDirty(false);
      setLeaving(false);
      flashSaved();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save regex script");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    if (await save()) {
      closeRegexDetail();
    } else {
      // Stay open so the error can be read and the edits aren't lost.
      setLeaving(false);
    }
  }

  async function remove() {
    if (!regexDetailId || isNew) return;
    const confirmed = await showConfirmDialog({
      title: "Delete Regex Script",
      message: "Delete this regex script? This cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    setDeleteError(null);
    try {
      await deleteScript.mutateAsync(regexDetailId);
      closeRegexDetail();
    } catch (error) {
      setDeleteError(`Couldn't delete: ${errorText(error)}`);
    }
  }

  function back() {
    if (dirty) setLeaving(true);
    else closeRegexDetail();
  }

  function dismissError() {
    setSaveError(null);
    setDeleteError(null);
  }

  return {
    found,
    scriptId: isNew ? null : regexDetailId,
    form,
    edit,
    characters,
    liveText: liveTest.text,
    setLiveText,
    patternError,
    result,
    dirty,
    saving,
    saved,
    saveError,
    bannerError: saveError ?? deleteError,
    leaving,
    save,
    saveAndClose,
    remove,
    back,
    keepEditing: () => setLeaving(false),
    discard: closeRegexDetail,
    dismissError,
  };
}

export type RegexScriptEditorModel = ReturnType<typeof useRegexScriptEditor>;
