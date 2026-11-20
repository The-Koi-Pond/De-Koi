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
import {
  LIVE_TEST_SLOW_NOTE,
  LIVE_TEST_UNTESTED_NOTE,
  liveTestResult,
  regexPatternError,
  regexPatternRisky,
  sampleResolvedPattern,
  trialRunRegex,
  type TrialVerdict,
} from "./live-test";
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

/** What the form was last reset for: the open id and the copy of its row (none for a new or missing script). */
interface LoadedSource {
  id: string | null;
  row: RegexScriptRow | undefined;
}

/**
 * A save whose list refresh hasn't reached the form yet: the script it is for (the new id once a new
 * script is created) and how many edits the form had when the save was sent.
 */
interface PendingEcho {
  id: string;
  fromNew: boolean;
  edits: number;
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
  // Counts every edit, so a save can tell whether anything was typed after it was sent.
  const editCount = useRef(0);
  const pendingEcho = useRef<PendingEcho | null>(null);

  // Reset the form whenever the open id changes (also to a missing one, so abandoned edits never come
  // back) or the list hands over a new copy of this row (a save refreshes the list). Done while
  // rendering so no frame shows the previous script.
  if (loaded === null || loaded.id !== regexDetailId || loaded.row !== row) {
    const echo = pendingEcho.current;
    const isEcho =
      echo !== null &&
      regexDetailId === echo.id &&
      (loaded?.id === echo.id || (echo.fromNew && loaded?.id === NEW_REGEX_SCRIPT_ID));
    // The refreshed copy of the script just saved has arrived once its row shows up.
    if (isEcho && row !== undefined) pendingEcho.current = null;
    if (isEcho && editCount.current !== echo.edits) {
      // Edits typed while the save was on its way aren't in that copy: keep them, still unsaved.
      setLoaded({ id: regexDetailId, row });
    } else {
      if (!isEcho) pendingEcho.current = null;
      resetFor(regexDetailId, row);
    }
  }

  function resetFor(id: string | null, row: RegexScriptRow | undefined) {
    setLoaded({ id, row });
    setForm(row ? regexScriptFormFromRow(row) : newRegexScriptForm());
    setDirty(false);
    setSaveError(null);
    setDeleteError(null);
    setLeaving(false);
    // The Live Test text survives a reload of the same script, not a switch to another one.
    if (liveTest.scriptId !== id) setLiveTest({ scriptId: id, text: "" });
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

  // A pattern with a repeat inside a repeat gets a timed trial run in a background worker before Live
  // Test runs it here, so one that backtracks catastrophically can't hang the page.
  const trialKey = useMemo(() => {
    if (!liveTest.text || patternError !== null) return null;
    const resolved = sampleResolvedPattern(form.findRegex, liveTest.text);
    return resolved && regexPatternRisky(resolved) ? JSON.stringify([resolved, form.flags, liveTest.text]) : null;
  }, [form.findRegex, form.flags, liveTest.text, patternError]);
  const [trial, setTrial] = useState<{ key: string; verdict: TrialVerdict } | null>(null);
  useEffect(() => {
    if (trialKey === null) return;
    const [source, flags, text] = JSON.parse(trialKey) as [string, string, string];
    return trialRunRegex(source, flags, text, (verdict) => setTrial({ key: trialKey, verdict })).cancel;
  }, [trialKey]);
  // null while the trial run is still going: no result and no note yet.
  const trialVerdict: TrialVerdict | null = trialKey === null ? "fast" : trial?.key === trialKey ? trial.verdict : null;

  const result = useMemo(
    () =>
      liveTest.text && trialVerdict === "fast"
        ? liveTestResult({
            liveText: liveTest.text,
            findRegex: form.findRegex,
            replaceString: form.replaceString,
            flags: form.flags,
            trimStrings: form.trimStrings,
            patternError,
          })
        : null,
    [liveTest.text, trialVerdict, form.findRegex, form.replaceString, form.flags, form.trimStrings, patternError],
  );

  /** Every edit to a saved field marks the form unsaved. */
  const edit = useCallback((change: (current: RegexScriptForm) => Partial<RegexScriptForm>) => {
    setForm((current) => ({ ...current, ...change(current) }));
    editCount.current += 1;
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
    // Save is disabled for this; Save & close checks it here.
    if (patternError) {
      setSaveError(`Fix the find pattern first: ${patternError}`);
      return false;
    }
    setSaving(true);
    const echo: PendingEcho = { id: regexDetailId, fromNew: isNew, edits: editCount.current };
    pendingEcho.current = echo;
    try {
      const payload = regexScriptSavePayload(form);
      if (isNew) {
        const created = await createScript.mutateAsync(payload);
        if (created?.id) {
          echo.id = created.id;
          // The script just created is the one being edited, so its Live Test text stays.
          setLiveTest((current) => ({ ...current, scriptId: created.id }));
          openRegexDetail(created.id);
        }
      } else {
        await updateScript.mutateAsync({ id: regexDetailId, ...payload });
      }
      const typedSince = editCount.current !== echo.edits;
      setDirty(typedSince);
      setLeaving(false);
      if (!typedSince) flashSaved();
      return true;
    } catch (error) {
      if (pendingEcho.current === echo) pendingEcho.current = null;
      setSaveError(error instanceof Error ? error.message : "Failed to save regex script");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    const editsBefore = editCount.current;
    const ok = await save();
    // Edits typed while the save was on its way aren't saved yet, so those keep the editor open too.
    if (ok && editCount.current === editsBefore) {
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
    liveTestNote:
      trialVerdict === "slow" ? LIVE_TEST_SLOW_NOTE : trialVerdict === "untested" ? LIVE_TEST_UNTESTED_NOTE : null,
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
