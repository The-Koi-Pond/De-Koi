// ──────────────────────────────────────────────
// Full-Page Preset Editor
// Tabs: Overview · Sections · Parameters · Review
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useMemo } from "react";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useChat } from "../../chats/index";
import {
  usePresetFull,
  useUpdatePreset,
  useDeletePreset,
  useCreateSection,
  useUpdateSection,
  useDeleteSection,
  useReorderSections,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useCreateVariable,
  useUpdateVariable,
  useDeleteVariable,
  useReorderVariables,
} from "../hooks/use-presets";
import { ArrowLeft, Save, Trash2, FileText, Layers, Sparkles, Code2, Hash, Type, X, AlertTriangle } from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { HelpTooltip } from "../../../../shared/components/ui/HelpTooltip";
import { exportApi } from "../../../../shared/api/export-api";
import { toastExportError, triggerDownloadWithToast } from "../../../shared/lib/export-feedback";
import { connectionsUtilityApi } from "../../../../shared/api/integration-utility-api";
import { reviewPromptPreset } from "../../../../engine/generation/prompt-reviewer";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import type {
  ChoiceBlock,
  GenerationParameters,
  MarkerConfig,
  WrapFormat,
  MarkerType,
  PromptGroup,
  PromptSection,
} from "../../../../engine/contracts/types/prompt";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { PresetSectionsTab } from "./preset-sections";

type PromptSectionRow = Omit<PromptSection, "enabled" | "isMarker" | "forbidOverrides" | "markerConfig"> & {
  enabled: boolean | string;
  isMarker: boolean | string;
  forbidOverrides: boolean | string;
  markerConfig: MarkerConfigRow | string | null;
};

type ChoiceBlockRow = Omit<ChoiceBlock, "multiSelect" | "randomPick"> & {
  variable_name?: string | null;
  multiSelect: boolean | string;
  randomPick: boolean | string;
};

type MarkerConfigRow = Omit<MarkerConfig, "type"> & { type: MarkerType | string };

// ── Tab definitions ──

const TABS = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "sections", label: "Sections", icon: Layers },
  { id: "review", label: "AI Review", icon: Sparkles },
] as const;
type TabId = (typeof TABS)[number]["id"];

function readBoolFlag(value: unknown): boolean {
  return value === true || value === "true";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readMarkerConfig(value: unknown): MarkerConfigRow | null {
  if (!value) return null;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const config = readRecord(parsed);
  if (typeof config.type !== "string") return null;
  return config as MarkerConfigRow;
}

// ═══════════════════════════════════════════════
//  Main Editor
// ═══════════════════════════════════════════════

export function PresetEditor() {
  const presetDetailId = useUIStore((s) => s.presetDetailId);
  const closePresetDetail = useUIStore((s) => s.closePresetDetail);
  const activeChatId = useChatStore((s) => s.activeChatId);

  const { data, isLoading } = usePresetFull(presetDetailId);
  const { data: activeChat } = useChat(activeChatId);
  const updatePreset = useUpdatePreset();
  const deletePreset = useDeletePreset();
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const reorderSections = useReorderSections();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const createVariable = useCreateVariable();
  const updateVariable = useUpdateVariable();
  const deleteVariable = useDeleteVariable();
  const reorderVariables = useReorderVariables();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Local editable state
  const [localName, setLocalName] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [localWrapFormat, setLocalWrapFormat] = useState<WrapFormat>("xml");
  const [localAuthor, setLocalAuthor] = useState("");
  const [localParams, setLocalParams] = useState<Partial<GenerationParameters>>({});

  // Populate local state when data loads
  useEffect(() => {
    if (!data) return;
    const p = data.preset;
    setLocalName(p.name ?? "");
    setLocalDescription(p.description ?? "");
    setLocalWrapFormat(p.wrapFormat ?? "xml");
    setLocalAuthor(p.author ?? "");
    setLocalParams(p.parameters ?? {});
  }, [data]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closePresetDetail();
  }, [dirty, closePresetDetail]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!presetDetailId) return false;
    setSaveError(null);
    try {
      await updatePreset.mutateAsync({
        id: presetDetailId,
        name: localName,
        description: localDescription,
        wrapFormat: localWrapFormat,
        author: localAuthor,
        parameters: localParams,
      });
      setDirty(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
      return true;
    } catch (err) {
      setSaveError(toUserMessage(err, { fallback: "Couldn't save preset. Try again." }));
      return false;
    }
  }, [presetDetailId, localName, localDescription, localWrapFormat, localAuthor, localParams, updatePreset]);

  const handleDelete = useCallback(async () => {
    if (!presetDetailId) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Preset",
        message: "Delete this preset?",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    deletePreset.mutate(presetDetailId, { onSuccess: () => closePresetDetail() });
  }, [presetDetailId, deletePreset, closePresetDetail]);

  const markDirty = useCallback(() => setDirty(true), []);

  // Parse sections in order
  const sectionOrder = useMemo(() => {
    if (!data?.preset) return [];
    return Array.isArray(data.preset.sectionOrder) ? data.preset.sectionOrder : [];
  }, [data]);

  const orderedSections = useMemo<PromptSectionRow[]>(() => {
    if (!data?.sections) return [];
    const map = new Map<string, PromptSectionRow>(data.sections.map((section) => [section.id, section]));
    return sectionOrder.map((id) => map.get(id)).filter((section): section is PromptSectionRow => Boolean(section));
  }, [data?.sections, sectionOrder]);

  const sectionHasLorebookMarker = useMemo(() => {
    return orderedSections.some((section) => {
      if (!readBoolFlag(section.enabled)) return false;
      if (!readBoolFlag(section.isMarker)) return false;
      const config = readMarkerConfig(section.markerConfig);
      return config?.type === "lorebook" || config?.type === "world_info_before" || config?.type === "world_info_after";
    });
  }, [orderedSections]);
  const parentChatHasLorebook = useMemo(() => {
    try {
      const metadata =
        typeof activeChat?.metadata === "string"
          ? readRecord(JSON.parse(activeChat.metadata))
          : readRecord(activeChat?.metadata);
      return Array.isArray(metadata.activeLorebookIds) && metadata.activeLorebookIds.length > 0;
    } catch {
      return false;
    }
  }, [activeChat?.metadata]);

  const groupMap = useMemo(() => {
    if (!data?.groups) return new Map<string, PromptGroup>();
    return new Map(data.groups.map((group) => [group.id, group]));
  }, [data?.groups]);

  const choiceBlocks = useMemo<ChoiceBlockRow[]>(() => {
    if (!data?.choiceBlocks) return [];
    return data.choiceBlocks;
  }, [data?.choiceBlocks]);

  if (!presetDetailId) return null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer h-4 w-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">Preset not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 max-md:gap-2 max-md:px-3">
        <button
          onClick={handleClose}
          className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
        >
          <ArrowLeft size="1.125rem" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 text-white shadow-sm max-md:h-8 max-md:w-8">
          <FileText size="1.125rem" className="max-md:h-[0.875rem]! max-md:w-[0.875rem]!" />
        </div>
        <input
          value={localName}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setLocalName(e.target.value);
            markDirty();
          }}
          className="h-10 min-w-0 flex-1 self-stretch bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)] max-md:text-base"
          placeholder="Preset name…"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={updatePreset.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size="0.8125rem" /> Save
          </button>
          <button
            onClick={async () => {
              if (!presetDetailId) return;
              try {
                triggerDownloadWithToast(await exportApi.prompt(presetDetailId), "Preset exported.");
              } catch (error) {
                toastExportError(error, "Failed to export preset.");
              }
            }}
            className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Export preset"
          >
            <svg
              width="0.9375rem"
              height="0.9375rem"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 13V3m0 0l-4 4m4-4l4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="3" y="15" width="14" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="rounded-xl p-2 transition-all hover:bg-[var(--destructive)]/15 active:scale-95"
          >
            <Trash2 size="0.9375rem" className="text-[var(--destructive)]" />
          </button>
        </div>
      </div>

      {/* Saved toast */}
      {showSaved && (
        <div className="absolute left-1/2 top-14 z-50 -translate-x-1/2 animate-fade-in-up rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 shadow-lg backdrop-blur-sm">
          Changes saved
        </div>
      )}

      {/* Unsaved warning */}
      {showUnsavedWarning && (
        <div className="flex items-center justify-between bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <span>You have unsaved changes.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnsavedWarning(false)}
              className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]"
            >
              Keep editing
            </button>
            <button
              onClick={() => closePresetDetail()}
              className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                const saved = await handleSave();
                if (saved) closePresetDetail();
              }}
              disabled={updatePreset.isPending}
              className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
            >
              Save & close
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertTriangle size="0.8125rem" />
          <span className="flex-1">{saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            className="rounded-lg px-2 py-0.5 hover:bg-red-500/20"
            aria-label="Dismiss save error"
          >
            <X size="0.75rem" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Body: Tab rail + Content ── */}
      <div className="flex flex-1 overflow-hidden @max-5xl:flex-col">
        {/* Tab rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-2 @max-5xl:w-full @max-5xl:flex-row @max-5xl:overflow-x-auto @max-5xl:border-r-0 @max-5xl:border-b @max-5xl:p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-all @max-5xl:whitespace-nowrap @max-5xl:px-2.5 @max-5xl:py-1.5",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-purple-400/15 to-violet-500/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/20"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon size="0.875rem" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 @max-5xl:p-4">
          <div className="mx-auto max-w-2xl space-y-6">
            {/* ── Overview Tab ── */}
            {activeTab === "overview" && (
              <OverviewTab
                name={localName}
                onNameChange={(v) => {
                  setLocalName(v);
                  markDirty();
                }}
                description={localDescription}
                onDescriptionChange={(v) => {
                  setLocalDescription(v);
                  markDirty();
                }}
                wrapFormat={localWrapFormat}
                onWrapFormatChange={(v) => {
                  setLocalWrapFormat(v);
                  markDirty();
                }}
                author={localAuthor}
                onAuthorChange={(v) => {
                  setLocalAuthor(v);
                  markDirty();
                }}
                sectionCount={orderedSections.length}
                groupCount={data.groups?.length ?? 0}
              />
            )}

            {/* ── Sections Tab ── */}
            {activeTab === "sections" && (
              <PresetSectionsTab
                presetId={presetDetailId}
                sections={orderedSections}
                groupMap={groupMap}
                choiceBlocks={choiceBlocks}
                wrapFormat={localWrapFormat}
                onCreateSection={createSection}
                onUpdateSection={updateSection}
                onDeleteSection={deleteSection}
                onReorderSections={reorderSections}
                onCreateGroup={createGroup}
                onUpdateGroup={updateGroup}
                onDeleteGroup={deleteGroup}
                onCreateVariable={createVariable}
                onUpdateVariable={updateVariable}
                onDeleteVariable={deleteVariable}
                onReorderVariables={reorderVariables}
                hasLorebookMarker={sectionHasLorebookMarker}
                parentChatHasLorebook={parentChatHasLorebook}
              />
            )}

            {/* ── Review Tab ── */}
            {activeTab === "review" && <ReviewTab presetId={presetDetailId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Overview Tab
// ═══════════════════════════════════════════════

function OverviewTab({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  wrapFormat,
  onWrapFormatChange,
  author,
  onAuthorChange,
  sectionCount,
  groupCount,
}: {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  wrapFormat: WrapFormat;
  onWrapFormatChange: (v: WrapFormat) => void;
  author: string;
  onAuthorChange: (v: string) => void;
  sectionCount: number;
  groupCount: number;
}) {
  return (
    <>
      <FieldGroup label="Name" help="The display name for this preset. Used in the Presets panel and chat settings.">
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Preset name…"
          className="w-full rounded-xl bg-[var(--secondary)] p-3 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </FieldGroup>

      <FieldGroup
        label="Description"
        help="A short summary of what this preset is designed for. Helps you remember its purpose when choosing between presets."
      >
        <textarea
          value={description}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="What does this preset do?"
          className="min-h-[5rem] w-full rounded-xl bg-[var(--secondary)] p-3 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </FieldGroup>

      <FieldGroup
        label="Wrap Format"
        help="Controls how prompt sections are formatted when sent to the AI. XML uses <tags>, Markdown uses ## headings, None sends raw content."
      >
        <div className="flex gap-2">
          {(["xml", "markdown", "none"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onWrapFormatChange(fmt)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all",
                wrapFormat === fmt
                  ? "bg-purple-400/15 text-purple-400 ring-1 ring-purple-400/30"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
              )}
            >
              {fmt === "xml" ? (
                <Code2 size="0.875rem" />
              ) : fmt === "markdown" ? (
                <Hash size="0.875rem" />
              ) : (
                <Type size="0.875rem" />
              )}
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
          {wrapFormat === "xml"
            ? "Sections wrapped in <xml_tags>. Groups become parent tags."
            : wrapFormat === "markdown"
              ? "Sections wrapped with ## Headings. Groups become # Headings."
              : "No automatic wrapping. Section content is sent as-is."}
        </p>
      </FieldGroup>

      <FieldGroup label="Author" help="Optional creator name, useful if you share presets with others.">
        <input
          value={author}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onAuthorChange(e.target.value)}
          placeholder="Your name (optional)"
          className="w-full rounded-xl bg-[var(--secondary)] p-2.5 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </FieldGroup>

      <div className="flex gap-4">
        <StatCard label="Sections" value={sectionCount} />
        <StatCard label="Groups" value={groupCount} />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════
//  Review Tab (placeholder — wires to prompt reviewer)
// ═══════════════════════════════════════════════

function ReviewTab({ presetId }: { presetId: string }) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewOutput, setReviewOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startReview = async (connectionId: string) => {
    setReviewing(true);
    setReviewOutput("");
    setError(null);

    try {
      for await (const event of reviewPromptPreset(
        { storage: storageApi, llm: llmApi },
        {
          presetId,
          connectionId,
          streaming: true,
          focusAreas: ["clarity", "consistency", "coverage", "token_efficiency"],
        },
      )) {
        if (event.type === "token") {
          setReviewOutput((prev) => prev + String(event.data ?? ""));
        } else if (event.type === "error") {
          setError(String(event.data ?? "Review failed"));
        }
      }
    } catch (err) {
      setError(toUserMessage(err, { fallback: "Review failed. Try again." }));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <>
      <FieldGroup label="AI Prompt Review">
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Have an AI analyze your prompt preset for clarity, consistency, coverage, and efficiency. This requires an
          active API connection.
        </p>
        <ConnectionSelector
          onSelect={(connId) => startReview(connId)}
          disabled={reviewing}
          label={reviewing ? "Reviewing…" : "Start Review"}
        />
      </FieldGroup>

      {error && (
        <div className="rounded-xl bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">{error}</div>
      )}

      {reviewOutput && (
        <div className="rounded-xl bg-[var(--secondary)] p-4 ring-1 ring-[var(--border)]">
          <pre className="whitespace-pre-wrap text-xs text-[var(--foreground)]">{reviewOutput}</pre>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════
//  Shared UI Components
// ═══════════════════════════════════════════════

function FieldGroup({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
        {help && <HelpTooltip text={help} />}
      </label>
      {children}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-xl bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)]">
      <span className="text-xl font-bold text-[var(--foreground)]">{value}</span>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}

/** Simple connection selector — queries the connections API */
function ConnectionSelector({
  onSelect,
  disabled,
  label,
}: {
  onSelect: (connectionId: string) => void;
  disabled: boolean;
  label: string;
}) {
  const [connId, setConnId] = useState("");

  // Quick inline read of connections
  const [connections, setConnections] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    connectionsUtilityApi
      .list<Array<{ id: string; name: string }>>()
      .then((data) => setConnections(data))
      .catch(() => {});
  }, []);

  return (
    <div className="flex gap-2">
      <select
        value={connId}
        onChange={(e) => setConnId(e.target.value)}
        className="flex-1 rounded-xl bg-[var(--secondary)] px-2.5 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none"
      >
        <option value="">Select connection…</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        disabled={disabled || !connId}
        onClick={() => onSelect(connId)}
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
      >
        <Sparkles size="0.8125rem" /> {label}
      </button>
    </div>
  );
}
