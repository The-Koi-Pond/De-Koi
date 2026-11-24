// The shell's state and actions (docs/provenance/preset-overview.md, "Data", "Saving", "Bars"): the draft of the
// Overview fields, its unsaved flag mirrored to the UI store, Save / Save & close, Back, Export and Delete.
import { useEffect, useMemo, useRef, useState } from "react";
import { exportApi } from "../../../../../shared/api/export-api";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { toastExportError, triggerDownloadWithToast } from "../../../../shared/lib/export-feedback";
import { useChat } from "../../../chats/index";
import {
  useCreateGroup,
  useCreateSection,
  useCreateVariable,
  useDeleteGroup,
  useDeletePreset,
  useDeleteSection,
  useDeleteVariable,
  usePresetFull,
  useReorderSections,
  useReorderVariables,
  useUpdateGroup,
  useUpdatePreset,
  useUpdateSection,
  useUpdateVariable,
  type PresetFullData,
} from "../../hooks/use-presets";
import type { ChoiceBlockRow } from "../preset-variables/variable-row";
import {
  chatHasLorebooks,
  draftFromPreset,
  EMPTY_DRAFT,
  hasLorebookMarker,
  orderedSections,
  type PresetDraft,
} from "./preset-data";

export type EditorTab = "overview" | "sections" | "review";

const SAVE_FALLBACK = "Couldn't save preset. Try again.";
const SAVED_NOTICE_MS = 1500;

export function usePresetEditor() {
  const presetDetailId = useUIStore((state) => state.presetDetailId);
  const closePresetDetail = useUIStore((state) => state.closePresetDetail);
  const setEditorDirty = useUIStore((state) => state.setEditorDirty);
  const activeChatId = useChatStore((state) => state.activeChatId);

  // The preset is read before the chat (the recordings pin the order of the reads).
  const presetQuery = usePresetFull(presetDetailId);
  const chatQuery = useChat(activeChatId);
  const updatePreset = useUpdatePreset();
  const deletePreset = useDeletePreset();
  const mutations = {
    onCreateSection: useCreateSection(),
    onUpdateSection: useUpdateSection(),
    onDeleteSection: useDeleteSection(),
    onReorderSections: useReorderSections(),
    onCreateGroup: useCreateGroup(),
    onUpdateGroup: useUpdateGroup(),
    onDeleteGroup: useDeleteGroup(),
    onCreateVariable: useCreateVariable(),
    onUpdateVariable: useUpdateVariable(),
    onDeleteVariable: useDeleteVariable(),
    onReorderVariables: useReorderVariables(),
  };

  const data = presetQuery.data;
  const [tab, setTab] = useState<EditorTab>("overview");
  const [draft, setDraft] = useState<PresetDraft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedVisible, setSavedVisible] = useState(false);
  // Set from the Delete click until the delete settles (or another preset opens), so a second click neither asks again
  // nor deletes twice (spec follow-up 7).
  const deleting = useRef(false);
  // Per field, how many edits were typed since it last matched storage; a field listed here is "edited". Refs, so a
  // save that lands can compare against the counts it started with. `generation` changes with the preset.
  const edits = useRef<Partial<Record<keyof PresetDraft, number>>>({});
  const generation = useRef(0);
  // The `data` object the draft was last synced with. A refresh with the same content keeps the same object (the query
  // shares structure), so only new content, a first load or another preset is synced.
  const [draftSource, setDraftSource] = useState<PresetFullData | undefined>(undefined);
  if (data !== draftSource) {
    setDraftSource(data);
    if (data) {
      const stored = draftFromPreset(data.preset);
      if (draftSource && draftSource.preset.id === data.preset.id) {
        // New content for the same preset (a save landing, a Sections or variables save, an outside update): edited
        // fields keep the typing, the rest take the stored values (spec follow-ups 1 and 2).
        const edited = Object.keys(edits.current) as Array<keyof PresetDraft>;
        setDraft((current) => keepEdits(current, edited, stored));
      } else {
        // A first load or another preset starts clean (spec follow-up 5).
        edits.current = {};
        generation.current += 1;
        deleting.current = false;
        setDraft(stored);
        setDirty(false);
        setLeaving(false);
        setSaveError(null);
      }
    }
  }

  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);

  const noticeTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = noticeTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  /** Shows "Changes saved" for 1.5 s from the latest save (spec follow-up 9). */
  function flashSaved() {
    for (const timer of noticeTimers.current) clearTimeout(timer);
    noticeTimers.current.clear();
    setSavedVisible(true);
    const timer = setTimeout(() => {
      noticeTimers.current.delete(timer);
      setSavedVisible(false);
    }, SAVED_NOTICE_MS);
    noticeTimers.current.add(timer);
  }

  const sections = useMemo(() => (data ? orderedSections(data.preset, data.sections) : []), [data]);
  const groupMap = useMemo(() => new Map((data?.groups ?? []).map((group) => [group.id, group])), [data]);
  const choiceBlocks = useMemo(() => (data?.choiceBlocks ?? []) as unknown as ChoiceBlockRow[], [data]);
  const lorebookMarker = useMemo(() => hasLorebookMarker(sections), [sections]);

  function edit(patch: Partial<PresetDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    for (const key of Object.keys(patch) as Array<keyof PresetDraft>)
      edits.current[key] = (edits.current[key] ?? 0) + 1;
  }

  /** Saves the draft; true when it worked. */
  async function save(): Promise<boolean> {
    if (!presetDetailId) return false;
    setSaveError(null);
    const editsAtStart = { ...edits.current };
    const generationAtStart = generation.current;
    try {
      await updatePreset.mutateAsync({
        id: presetDetailId,
        name: draft.name,
        description: draft.description,
        wrapFormat: draft.wrapFormat,
        author: draft.author,
        parameters: draft.parameters,
      });
      // Fields not typed in since the save started are stored now; fields typed in during it stay edited. A save that
      // lands after another preset opened leaves that preset's state alone.
      if (generation.current === generationAtStart) {
        for (const key of Object.keys(editsAtStart) as Array<keyof PresetDraft>) {
          if (edits.current[key] === editsAtStart[key]) delete edits.current[key];
        }
        if (Object.keys(edits.current).length === 0) {
          setDirty(false);
          // The unsaved bar goes with the unsaved changes (spec follow-up 6).
          setLeaving(false);
        }
      }
      flashSaved();
      return true;
    } catch (error) {
      if (generation.current === generationAtStart) setSaveError(toUserMessage(error, { fallback: SAVE_FALLBACK }));
      return false;
    }
  }

  async function saveAndClose() {
    if (await save()) closePresetDetail();
  }

  function back() {
    if (dirty) setLeaving(true);
    else closePresetDetail();
  }

  async function exportPreset() {
    if (!presetDetailId) return;
    try {
      triggerDownloadWithToast(await exportApi.prompt(presetDetailId), "Preset exported.");
    } catch (error) {
      toastExportError(error, "Failed to export preset.");
    }
  }

  async function remove() {
    if (!presetDetailId || deleting.current) return;
    const id = presetDetailId;
    deleting.current = true;
    const confirmed = await showConfirmDialog({
      title: "Delete Preset",
      message: "Delete this preset?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) {
      deleting.current = false;
      return;
    }
    deletePreset.mutate(id, {
      onSuccess: () => closePresetDetail(),
      onSettled: () => {
        deleting.current = false;
      },
    });
  }

  return {
    presetDetailId,
    loading: presetQuery.isLoading,
    data,
    tab,
    setTab,
    draft,
    edit,
    dirty,
    saving: updatePreset.isPending,
    leaving,
    saveError,
    savedVisible,
    sections,
    groupMap,
    choiceBlocks,
    hasLorebookMarker: lorebookMarker,
    // No active chat, or its row still loading, failing or missing: no data, so no lorebooks.
    parentChatHasLorebook: chatHasLorebooks(chatQuery.data),
    mutations,
    save,
    saveAndClose,
    back,
    keepEditing: () => setLeaving(false),
    discard: () => closePresetDetail(),
    dismissError: () => setSaveError(null),
    exportPreset,
    remove,
  };
}

export type PresetEditorModel = ReturnType<typeof usePresetEditor>;

/** The draft after a refresh: edited fields keep the draft, the rest take the stored values. */
function keepEdits(draft: PresetDraft, edited: ReadonlyArray<keyof PresetDraft>, stored: PresetDraft): PresetDraft {
  const next = { ...stored };
  for (const key of edited) next[key] = draft[key];
  return next;
}
