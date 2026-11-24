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
  // The `data` object the draft was last synced with, and the stored values the draft's edits are measured against
  // (the stored fields, or what the last save sent). A refresh with the same content keeps the same object (the query
  // shares structure), so only new content, a first load or another preset is synced.
  const [draftSource, setDraftSource] = useState<PresetFullData | undefined>(undefined);
  const [draftBase, setDraftBase] = useState<PresetDraft>(EMPTY_DRAFT);
  if (data !== draftSource) {
    setDraftSource(data);
    if (data) {
      const stored = draftFromPreset(data.preset);
      if (draftSource && draftSource.preset.id === data.preset.id) {
        // New content for the same preset (a save landing, a Sections or variables save, an outside update): fields
        // typed since the base keep the typing, the rest take the stored values (spec follow-ups 1 and 2).
        setDraft((current) => keepEdits(current, draftBase, stored));
      } else {
        // A first load or another preset starts clean (spec follow-up 5).
        setDraft(stored);
        setDirty(false);
        setLeaving(false);
        setSaveError(null);
      }
      setDraftBase(stored);
    }
  }
  // Counts edits, so a save that lands only marks the draft saved when nothing was typed while it ran.
  const editCount = useRef(0);

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
    editCount.current += 1;
  }

  /** Saves the draft; true when it worked. */
  async function save(): Promise<boolean> {
    if (!presetDetailId) return false;
    setSaveError(null);
    const sent = draft;
    const editsAtStart = editCount.current;
    try {
      await updatePreset.mutateAsync({
        id: presetDetailId,
        name: sent.name,
        description: sent.description,
        wrapFormat: sent.wrapFormat,
        author: sent.author,
        parameters: sent.parameters,
      });
      // What was sent is now stored: the refresh this save causes measures edits against it, so it keeps text typed
      // during the save and takes the stored form of the rest.
      setDraftBase(sent);
      if (editCount.current === editsAtStart) {
        setDirty(false);
        // The unsaved bar goes with the unsaved changes (spec follow-up 6).
        setLeaving(false);
      }
      flashSaved();
      return true;
    } catch (error) {
      setSaveError(toUserMessage(error, { fallback: SAVE_FALLBACK }));
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

  // Set from the Delete click until the delete settles, so a second click neither asks again nor deletes twice (spec
  // follow-up 7).
  const deleting = useRef(false);
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

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    JSON.stringify(a) === JSON.stringify(b)
  );
}

/** The draft after a refresh: each field still equal to `base` takes the `stored` value; edited fields keep the draft. */
function keepEdits(draft: PresetDraft, base: PresetDraft, stored: PresetDraft): PresetDraft {
  const next = { ...stored };
  for (const key of Object.keys(stored) as Array<keyof PresetDraft>) {
    if (!sameValue(draft[key], base[key])) next[key] = draft[key];
  }
  return next;
}
