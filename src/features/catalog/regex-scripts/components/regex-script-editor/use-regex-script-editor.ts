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
  samplePattern,
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

/** A save sent from this editor whose refreshed row hasn't come back yet: the script and what was sent. */
interface SentSave {
  scriptId: string;
  payload: string;
}

/** The Live Test text and the script it was typed for. */
interface LiveTestState {
  scriptId: string | null;
  text: string;
}

/** What Live Test shows under the text box. */
interface LiveTestShown {
  result: string | null;
  note: string | null;
}

const NOTHING_SHOWN: LiveTestShown = { result: null, note: null };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function payloadKey(form: RegexScriptForm): string {
  return JSON.stringify(regexScriptSavePayload(form));
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

  // Saves finish after awaits, so they read the open script and the edit count from refs.
  const openId = useRef(regexDetailId);
  openId.current = regexDetailId;
  const editCount = useRef(0);
  const saveCount = useRef(0);
  const sentSaves = useRef<SentSave[]>([]);
  // A script this editor just created from New, until the list hands over its row.
  const justCreated = useRef<string | null>(null);

  const isNew = regexDetailId === NEW_REGEX_SCRIPT_ID;
  const row = isNew || !regexDetailId ? undefined : scripts?.find((script) => script.id === regexDetailId);
  const found = isNew || row !== undefined || (regexDetailId !== null && regexDetailId === justCreated.current);

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

  /** True (and forgets it) when this copy of the row is what one of this editor's saves sent. */
  function isOwnSave(id: string, stored: RegexScriptRow): boolean {
    const key = payloadKey(regexScriptFormFromRow(stored));
    const index = sentSaves.current.findIndex((sent) => sent.scriptId === id && sent.payload === key);
    if (index === -1) return false;
    sentSaves.current = sentSaves.current.slice(index + 1);
    return true;
  }

  // Reset the form whenever the open id changes (also to a missing one, so abandoned edits never come
  // back) or the list hands over a new copy of this row. Done while rendering so no frame shows the
  // previous script. The copy a save of this editor brings back doesn't reset it: the form already
  // holds those values, or newer edits typed while the save was on its way.
  if (loaded === null || loaded.id !== regexDetailId || loaded.row !== row) {
    const created = regexDetailId !== null && regexDetailId === justCreated.current;
    const sameScript =
      loaded !== null && (loaded.id === regexDetailId || (created && loaded.id === NEW_REGEX_SCRIPT_ID));
    if (sameScript && created && row === undefined) {
      // The new script is saved but the list hasn't caught up yet.
      setLoaded({ id: regexDetailId, row });
    } else if (sameScript && row !== undefined && regexDetailId !== null && isOwnSave(regexDetailId, row)) {
      justCreated.current = null;
      setLoaded({ id: regexDetailId, row });
    } else {
      sentSaves.current = [];
      justCreated.current = null;
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

  // Macros are resolved once per pattern and text, so the trial run and the page run the same pattern
  // (a macro such as {{random}} would otherwise resolve differently each time).
  const sample = useMemo(
    () => samplePattern(form.findRegex, form.flags, liveTest.text),
    [form.findRegex, form.flags, liveTest.text],
  );
  const patternError = sample.error;

  // Live Test runs a pattern on the page only after the same replace, on the same text, finished in time
  // in a background worker, so one that backtracks catastrophically can't hang the page.
  const trialKey =
    liveTest.text && sample.source !== null && sample.error === null
      ? JSON.stringify([sample.source, form.flags, liveTest.text])
      : null;
  const [trial, setTrial] = useState<{ key: string; verdict: TrialVerdict } | null>(null);
  useEffect(() => {
    if (trialKey === null) return;
    const [source, flags, text] = JSON.parse(trialKey) as [string, string, string];
    return trialRunRegex(source, flags, text, (verdict) => setTrial({ key: trialKey, verdict }));
  }, [trialKey]);
  // Nothing to try (no pattern, or one that doesn't compile) counts as fast; null while the trial runs.
  const trialVerdict: TrialVerdict | null = trialKey === null ? "fast" : trial?.key === trialKey ? trial.verdict : null;

  const fresh = useMemo<LiveTestShown | null>(() => {
    if (!liveTest.text) return NOTHING_SHOWN;
    if (trialVerdict === null) return null;
    if (trialVerdict === "slow") return { result: null, note: LIVE_TEST_SLOW_NOTE };
    if (trialVerdict === "untested") return { result: null, note: LIVE_TEST_UNTESTED_NOTE };
    return {
      result: liveTestResult({
        liveText: liveTest.text,
        source: sample.source,
        replaceString: form.replaceString,
        flags: form.flags,
        trimStrings: form.trimStrings,
      }),
      note: null,
    };
  }, [liveTest.text, trialVerdict, sample.source, form.replaceString, form.flags, form.trimStrings]);
  // While a trial runs (a few milliseconds), keep showing what was there, so the result doesn't blink.
  const lastShown = useRef<LiveTestShown>(NOTHING_SHOWN);
  const shown = fresh ?? lastShown.current;
  lastShown.current = shown;

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
    const startedOn = regexDetailId;
    const order = ++saveCount.current;
    const editsAtSend = editCount.current;
    const payload = regexScriptSavePayload(form);
    const sent: SentSave = { scriptId: startedOn, payload: JSON.stringify(payload) };
    sentSaves.current.push(sent);
    setSaving(true);
    try {
      if (isNew) {
        const created = await createScript.mutateAsync(payload);
        if (created?.id) {
          sent.scriptId = created.id;
          if (openId.current === startedOn) {
            justCreated.current = created.id;
            // The script just created is the one being edited, so its Live Test text stays.
            setLiveTest((current) => ({ ...current, scriptId: created.id }));
          }
          openRegexDetail(created.id);
        }
      } else {
        await updateScript.mutateAsync({ id: startedOn, ...payload });
      }
      // Only the newest save, while its script is still open, decides whether the form is saved.
      if (order === saveCount.current && openId.current === startedOn) {
        const typedSince = editCount.current !== editsAtSend;
        setDirty(typedSince);
        setLeaving(false);
        if (!typedSince) flashSaved();
      }
      return true;
    } catch (error) {
      sentSaves.current = sentSaves.current.filter((entry) => entry !== sent);
      setSaveError(error instanceof Error ? error.message : "Failed to save regex script");
      return false;
    } finally {
      if (order === saveCount.current) setSaving(false);
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
    result: shown.result,
    liveTestNote: shown.note,
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
