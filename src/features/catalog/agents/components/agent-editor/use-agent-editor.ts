import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { BUILT_IN_AGENTS } from "../../../../../engine/contracts/types/agent";
import { saveTextFileToUserSelectedLocation } from "../../../../../shared/api/file-save-api";
import { getAgentRunIntervalMeta } from "../../../../../shared/lib/agent-cadence";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useConnections } from "../../../connections/index";
import { useDeleteKnowledgeSource, useKnowledgeSources, useUploadKnowledgeSource } from "../../../knowledge/index";
import { useEntriesAcrossLorebooks, useLorebooks } from "../../../lorebooks/index";
import {
  useAgentConfigs,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
  agentEnabledFlag,
  type AgentConfigRow,
} from "../../hooks/use-agents";
import { useCustomToolCapabilities, useCustomTools } from "../../hooks/use-custom-tools";
import { agentExportFilename, buildAgentExportEnvelope, createCustomAgentType } from "../../lib/agent-import-export";
import { buildAgentLorebookWriterSaveState } from "../../lib/agent-lorebook-writer-settings";
import {
  NEW_AGENT_ID,
  agentSavePayload,
  formForNewAgent,
  formFromBuiltIn,
  formFromRow,
  type AgentForm,
} from "./agent-form";

const SAVED_FLASH_MS = 1500;
const SAVE_FALLBACK = "Couldn't save agent config. Try again.";

/** A connection row as the catalog lists it (only what the editor reads). */
export interface ConnectionOption {
  id: string;
  name: string;
  provider: string;
  defaultForAgents?: unknown;
}

const isAgentDefault = (connection: ConnectionOption) =>
  connection.defaultForAgents === true || connection.defaultForAgents === "true";

export function useAgentEditor() {
  const agentDetailId = useUIStore((state) => state.agentDetailId);
  const openAgentDetail = useUIStore((state) => state.openAgentDetail);
  const closeAgentDetail = useUIStore((state) => state.closeAgentDetail);
  const setEditorDirty = useUIStore((state) => state.setEditorDirty);

  // Called in this order on purpose: it is the order the lists are fetched in.
  const { data: agents } = useAgentConfigs();
  const { data: connectionRows } = useConnections();
  const { data: customTools } = useCustomTools();
  const { data: toolCapabilities } = useCustomToolCapabilities();
  const lorebooksQuery = useLorebooks();
  const { data: knowledgeSources } = useKnowledgeSources();
  const updateAgent = useUpdateAgent();
  const createAgent = useCreateAgent();
  const deleteAgent = useDeleteAgent();
  const uploadSource = useUploadKnowledgeSource();
  const deleteSource = useDeleteKnowledgeSource();

  const builtIn = BUILT_IN_AGENTS.find((agent) => agent.id === agentDetailId);
  const row = agentDetailId
    ? (agents as AgentConfigRow[] | undefined)?.find(
        (agent) => agent.type === agentDetailId || agent.id === agentDetailId,
      )
    : undefined;
  const isNew = agentDetailId === NEW_AGENT_ID;
  const found = !!agentDetailId && (!!builtIn || !!row || isNew);
  /** A custom agent, stored or new; a built-in opened by its row id counts too. */
  const custom = !builtIn && (!!row || isNew);
  const isType = useCallback((type: string) => agentDetailId === type || row?.type === type, [agentDetailId, row]);
  const defaultsType = row?.type ?? builtIn?.id ?? agentDetailId ?? "";

  const customCadence = custom
    ? getAgentRunIntervalMeta(isNew ? NEW_AGENT_ID : (row?.type ?? agentDetailId!), false)
    : null;
  const customCadenceDefault = customCadence?.defaultValue;
  // Shown for an agent of type `illustrator`; its numbers come from whatever built-in this is.
  const builtInCadence = builtIn ? getAgentRunIntervalMeta(builtIn.id) : null;

  const connections = connectionRows as ConnectionOption[] | undefined;

  const [form, setForm] = useState<AgentForm>(() => formForNewAgent(undefined));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Whether the custom cadence box has focus; kept here so it survives switching agents. */
  const [cadenceFocused, setCadenceFocused] = useState(false);

  // Fill the form whenever the agent, its stored row, the built-in, the connections or the custom cadence
  // default changes. A refetch that returns equal data keeps the same objects, so it doesn't refill.
  useEffect(() => {
    if (row) setForm(formFromRow(row, builtIn, defaultsType));
    else if (builtIn) setForm(formFromBuiltIn(builtIn));
    else setForm(formForNewAgent(customCadenceDefault));
    setDirty(false);
    setSaveError(null);
    // `defaultsType` follows from the id, the row and the built-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentDetailId, row, builtIn, connections, customCadenceDefault]);

  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);

  /** Every edit marks the form unsaved, even one that puts a value back. */
  const edit = useCallback((change: Partial<AgentForm> | ((current: AgentForm) => Partial<AgentForm>)) => {
    setForm((current) => ({ ...current, ...(typeof change === "function" ? change(current) : change) }));
    setDirty(true);
  }, []);

  const isRouter = isType("knowledge-router");
  const entries = useEntriesAcrossLorebooks(isRouter ? form.sourceLorebookIds : []);

  const saving = updateAgent.isPending || createAgent.isPending;
  const lorebooks = lorebooksQuery.data;

  async function save(): Promise<boolean> {
    if (!agentDetailId) return false;
    setSaveError(null);
    const writer = buildAgentLorebookWriterSaveState({
      enabledTools: form.enabledTools,
      isEditingCustomAgent: custom,
      lorebookWriteEnabled: form.lorebookWriteEnabled,
      writableLorebookId: form.writableLorebookId,
    });
    if (writer.lorebookWriterEnabled && !writer.writableLorebookId) {
      setSaveError("Select a target lorebook before enabling lorebook writing for this agent.");
      return false;
    }
    if (
      writer.lorebookWriterEnabled &&
      lorebooks &&
      !lorebooks.some((lorebook) => lorebook.id === writer.writableLorebookId)
    ) {
      setSaveError("Select an available target lorebook before enabling lorebook writing for this agent.");
      return false;
    }
    const payload = agentSavePayload(form, { custom, isType }, writer);
    try {
      if (row) {
        await updateAgent.mutateAsync({ id: row.id, ...payload });
      } else {
        const type = builtIn ? builtIn.id : createCustomAgentType(form.name);
        const created = (await createAgent.mutateAsync({ ...payload, type })) as { id?: string } | null;
        // Any truthy id is opened, as stored.
        if (custom && created?.id) openAgentDetail(created.id);
      }
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FLASH_MS);
      return true;
    } catch (error) {
      setSaveError(toUserMessage(error, { fallback: SAVE_FALLBACK }));
      return false;
    }
  }

  function back() {
    if (dirty) setLeaving(true);
    else closeAgentDetail();
  }

  async function saveAndClose() {
    if (await save()) closeAgentDetail();
  }

  async function remove() {
    if (!row) return;
    const confirmed = await showConfirmDialog({
      title: "Delete Agent",
      message: "Delete this custom agent? This cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    await deleteAgent.mutateAsync(row.id);
    closeAgentDetail();
  }

  async function exportAgent() {
    if (!row) return;
    const content = `${JSON.stringify(buildAgentExportEnvelope(row), null, 2)}\n`;
    setExporting(true);
    try {
      const result = await saveTextFileToUserSelectedLocation({
        filename: agentExportFilename(row),
        content,
        title: "Export Agent",
        mimeType: "application/json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result === "saved") toast.success("Agent exported.");
      else if (result === "downloaded") toast.success("Agent export downloaded.");
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: "Couldn't export agent. Try again." }));
    } finally {
      setExporting(false);
    }
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const source = await uploadSource.mutateAsync(file);
      edit((current) => ({ sourceFileIds: [...current.sourceFileIds, source.id] }));
    } catch {
      // A failed upload shows nothing more (recorded behavior; see the spec's follow-ups).
    } finally {
      input.value = "";
    }
  }

  function deleteFile(id: string) {
    deleteSource.mutate(id, {
      onSuccess: () =>
        setForm((current) => ({ ...current, sourceFileIds: current.sourceFileIds.filter((x) => x !== id) })),
    });
  }

  const llmConnections = useMemo(
    () => (connections ?? []).filter((connection) => connection.provider !== "image_generation"),
    [connections],
  );
  const imageConnections = useMemo(
    () => (connections ?? []).filter((connection) => connection.provider === "image_generation"),
    [connections],
  );

  const otherKnowledgeAgent = (() => {
    const router = isType("knowledge-router");
    const retrieval = isType("knowledge-retrieval");
    if (!router && !retrieval) return null;
    const enabledOfType = (type: string) =>
      (agents as AgentConfigRow[] | undefined)?.some(
        (agent) => agent.type === type && agentEnabledFlag(agent.enabled, true),
      ) ?? false;
    if (!enabledOfType("knowledge-router") || !enabledOfType("knowledge-retrieval")) return null;
    return router ? "Knowledge Retrieval" : "Knowledge Router";
  })();

  return {
    agentDetailId,
    found,
    isNew,
    builtIn,
    row,
    custom,
    isType,
    customCadence,
    builtInCadence,
    cadenceFocused,
    setCadenceFocused,
    form,
    edit,
    setForm,
    dirty,
    saving,
    saved,
    saveError,
    dismissError: () => setSaveError(null),
    leaving,
    keepEditing: () => setLeaving(false),
    discard: closeAgentDetail,
    back,
    save,
    saveAndClose,
    remove,
    exporting,
    exportAgent,
    lorebooksQuery,
    entries,
    customTools,
    toolCapabilities,
    knowledgeSources,
    uploading: uploadSource.isPending,
    uploadFile,
    deleteFile,
    llmConnections,
    imageConnections,
    agentDefaultConnection: llmConnections.find(isAgentDefault),
    imageDefaultConnection: imageConnections.find(isAgentDefault),
    otherKnowledgeAgent,
  };
}

export type AgentEditorModel = ReturnType<typeof useAgentEditor>;
