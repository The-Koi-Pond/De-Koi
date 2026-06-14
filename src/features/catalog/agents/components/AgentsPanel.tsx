// ──────────────────────────────────────────────
// Panel: Agents & Tools
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  Camera,
  Sparkles,
  Pencil,
  Plus,
  Wrench,
  ChevronDown,
  Trash2,
  Regex,
  PenLine,
  Radar,
  Puzzle,
  GripVertical,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  agentEnabledFlag,
  useAgentConfigs,
  useDeleteAgent,
  useSetAgentEnabledByType,
  useUploadAgentImage,
  type AgentConfigRow,
} from "../hooks/use-agents";
import { useCustomTools, useDeleteCustomTool, type CustomToolRow } from "../hooks/use-custom-tools";
import {
  useRegexScripts,
  useDeleteRegexScript,
  useCreateRegexScript,
  useUpdateRegexScript,
  useReorderRegexScripts,
  type RegexScriptRow,
} from "../hooks/use-regex-scripts";
import {
  BUILT_IN_AGENTS,
  type AgentCategory,
} from "../../../../engine/contracts/types/agent";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { resolveEntityImageUrl } from "../../../../shared/api/local-file-api";
import { cn } from "../../../../shared/lib/utils";
import { regexScriptTargetCharacterIds } from "../lib/regex-script-filter";

function uniqueStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
  return Array.from(
    new Set(raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)),
  );
}

function importedRegexTargetCharacterIds(obj: Record<string, unknown>): string[] {
  const multiTargetIds = uniqueStringArray(obj.targetCharacterIds);
  if (multiTargetIds.length > 0) return multiTargetIds;
  return uniqueStringArray(obj.characterId);
}

export function AgentsPanel() {
  const { data: agentConfigs, isLoading } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const { data: regexScripts } = useRegexScripts();
  const deleteAgent = useDeleteAgent();
  const deleteTool = useDeleteCustomTool();
  const deleteRegex = useDeleteRegexScript();
  const setAgentEnabled = useSetAgentEnabledByType();
  const uploadAgentImage = useUploadAgentImage();
  const updateRegex = useUpdateRegexScript();
  const reorderRegexScripts = useReorderRegexScripts();
  const openAgentDetail = useUIStore((s) => s.openAgentDetail);
  const openToolDetail = useUIStore((s) => s.openToolDetail);
  const openRegexDetail = useUIStore((s) => s.openRegexDetail);
  const createRegexScript = useCreateRegexScript();
  const agentImageInputRef = useRef<HTMLInputElement>(null);
  const agentImageTargetRef = useRef<{ id?: string; agentType?: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [draggedRegexId, setDraggedRegexId] = useState<string | null>(null);
  const [regexDragReadyId, setRegexDragReadyId] = useState<string | null>(null);

  const sortedRegexScripts = useMemo(
    () => [...((regexScripts ?? []) as RegexScriptRow[])].sort((a, b) => a.order - b.order),
    [regexScripts],
  );

  // Handler for importing regex scripts from JSON (supports ST format and native)
  const handleImportRegex = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Accept a single object or an array
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0) throw new Error("No regex scripts found in file");
      let imported = 0;
      for (const obj of arr) {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
        const row = obj as Record<string, unknown>;
        // Resolve name: ST uses scriptName, native uses name
        const name = row.name || row.scriptName;
        // ST wraps regex in /delimiters/flags — extract pattern and flags
        let findRegex = typeof row.findRegex === "string" ? row.findRegex : "";
        let flags = typeof row.flags === "string" ? row.flags : "gi";
        const delimited = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
        if (delimited) {
          findRegex = delimited[1] ?? "";
          flags = delimited[2] || "g";
        }
        if (!name || !findRegex) continue;
        // ST placement uses numbers: 1 = user_input, 2 = ai_output
        const stPlacementMap: Record<number, string> = { 1: "user_input", 2: "ai_output" };
        let placement: string[] = ["ai_output"];
        if (Array.isArray(row.placement)) {
          const mapped = row.placement
            .map((p: unknown) => (typeof p === "number" ? stPlacementMap[p] : p))
            .filter((p: unknown): p is string => p === "ai_output" || p === "user_input");
          if (mapped.length > 0) placement = mapped;
        }
        // ST uses disabled (inverted), native uses enabled
        let enabled = true;
        if (typeof row.enabled === "boolean") enabled = row.enabled;
        else if (typeof row.enabled === "string") enabled = row.enabled !== "false";
        else if (typeof row.disabled === "boolean") enabled = !row.disabled;
        const targetCharacterIds = importedRegexTargetCharacterIds(row);

        await createRegexScript.mutateAsync({
          name,
          enabled,
          findRegex,
          characterId: targetCharacterIds[0] ?? null,
          targetCharacterIds,
          replaceString: row.replaceString ?? "",
          trimStrings: row.trimStrings ?? [],
          placement,
          flags,
          promptOnly: row.promptOnly ?? false,
          order: row.order ?? 0,
          minDepth: row.minDepth ?? null,
          maxDepth: row.maxDepth ?? null,
        });
        imported++;
      }
      setImportSuccess(`Imported ${imported} regex script(s).`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import regex scripts");
    }
    event.target.value = ""; // reset file input
  };

  const agentConfigRows = useMemo(() => ((agentConfigs ?? []) as AgentConfigRow[]), [agentConfigs]);
  const agentConfigByType = useMemo(() => {
    const map = new Map<string, AgentConfigRow>();
    for (const config of agentConfigRows) map.set(config.type, config);
    return map;
  }, [agentConfigRows]);
  const builtInAgentTypes = useMemo(() => new Set(BUILT_IN_AGENTS.map((agent) => agent.id)), []);

  // Custom agents = DB entries whose type doesn't match any built-in
  const customAgents = useMemo(
    () => agentConfigRows.filter((config) => !builtInAgentTypes.has(config.type)),
    [agentConfigRows, builtInAgentTypes],
  );
  const handleCreateAgent = () => {
    // Create a new custom agent immediately in DB then open editor
    openAgentDetail("__new__");
  };

  const handlePickAgentImage = useCallback((target: { id?: string; agentType?: string }) => {
    agentImageTargetRef.current = target;
    if (agentImageInputRef.current) {
      agentImageInputRef.current.value = "";
      agentImageInputRef.current.click();
    }
  }, []);

  const handleAgentImageSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const target = agentImageTargetRef.current;
      if (!file || !target) return;
      if (!file.type.startsWith("image/")) {
        agentImageTargetRef.current = null;
        toast.error("Choose an image file for the agent picture");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const image = typeof reader.result === "string" ? reader.result : "";
        if (!image) {
          toast.error("Could not read that image");
          return;
        }
        try {
          await uploadAgentImage.mutateAsync({ ...target, image, filename: file.name });
          toast.success("Agent picture updated");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to upload agent picture");
        } finally {
          agentImageTargetRef.current = null;
        }
      };
      reader.onerror = () => {
        agentImageTargetRef.current = null;
        toast.error("Could not read that image");
      };
      reader.readAsDataURL(file);
    },
    [uploadAgentImage],
  );

  const handleCreateTool = () => {
    openToolDetail("__new__");
  };

  const handleCreateRegex = () => {
    openRegexDetail("__new__");
  };

  const handleRegexDrop = (targetId: string) => {
    if (!draggedRegexId || draggedRegexId === targetId) return;
    const nextIds = sortedRegexScripts.map((script) => script.id);
    const from = nextIds.indexOf(draggedRegexId);
    const to = nextIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = nextIds.splice(from, 1);
    if (!moved) return;
    nextIds.splice(to, 0, moved);
    reorderRegexScripts.mutate(nextIds);
    setDraggedRegexId(null);
    setRegexDragReadyId(null);
  };

  return (
    <div className="flex flex-col gap-1 p-3">
      <input
        ref={agentImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAgentImageSelected}
      />

      {isLoading && <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">Loading...</div>}

      {/* ── Regex Scripts (moved to top) ── */}
      <PanelSection
        title="Regex Scripts"
        icon={<Regex size="0.8125rem" />}
        action={
          <div className="flex items-center gap-1">
            <button
              onClick={handleCreateRegex}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
              title="Create regex script"
            >
              <Plus size="0.8125rem" />
            </button>
            <label
              className="inline-flex items-center justify-center rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] cursor-pointer"
              title="Import regex scripts from JSON"
            >
              <input type="file" accept="application/json" className="hidden" onChange={handleImportRegex} />
              <svg
                width="0.9375rem"
                height="0.9375rem"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 3v10m0 0l-4-4m4 4l4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect x="3" y="17" width="14" height="2" rx="1" fill="currentColor" />
              </svg>
            </label>
          </div>
        }
      >
        <div className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">
          Find/replace patterns applied to AI output or user input — like SillyTavern regex scripts.
        </div>
        {importError && <div className="text-xs text-red-500 mb-1">{importError}</div>}
        {importSuccess && <div className="text-xs text-green-500 mb-1">{importSuccess}</div>}
        {sortedRegexScripts.length === 0 ? (
          <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1 py-2">No regex scripts yet.</p>
        ) : (
          sortedRegexScripts.map((script) => {
            const placements = Array.isArray(script.placement) ? script.placement : [];
            const targetCharacterIds = regexScriptTargetCharacterIds(script);
            // Stored as a boolean; tolerate the legacy string form too.
            const enabled = script.enabled === true || script.enabled === "true" || script.enabled === "1";
            return (
              <div
                key={script.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
                  !enabled && "opacity-50",
                  draggedRegexId === script.id && "opacity-40",
                )}
                draggable={regexDragReadyId === script.id}
                onDragStart={(event) => {
                  setDraggedRegexId(script.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", script.id);
                }}
                onDragOver={(event) => {
                  if (draggedRegexId && draggedRegexId !== script.id) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleRegexDrop(script.id);
                }}
                onDragEnd={() => {
                  setDraggedRegexId(null);
                  setRegexDragReadyId(null);
                }}
              >
                <button
                  className="mt-0.5 shrink-0 cursor-grab rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] active:cursor-grabbing"
                  title="Drag to reorder"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setRegexDragReadyId(script.id);
                  }}
                  onMouseUp={(event) => {
                    event.stopPropagation();
                    setRegexDragReadyId(null);
                  }}
                >
                  <GripVertical size="0.8125rem" />
                </button>
                <Regex size="0.875rem" className="mt-0.5 shrink-0 text-orange-400" />
                <button className="min-w-0 flex-1 text-left" onClick={() => openRegexDetail(script.id)}>
                  <div className="text-xs font-medium">{script.name}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {placements.map((p: string) => (
                      <span
                        key={p}
                        className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]"
                      >
                        {p === "ai_output" ? "AI" : "User"}
                      </span>
                    ))}
                    <span className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                      {targetCharacterIds.length === 0
                        ? "Global"
                        : targetCharacterIds.length === 1
                          ? "1 char"
                          : `${targetCharacterIds.length} chars`}
                    </span>
                    <span className="text-[0.5625rem] text-[var(--muted-foreground)] font-mono truncate max-w-[6.25rem]">
                      /{script.findRegex}/{script.flags}
                    </span>
                  </div>
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                  title={enabled ? "Disable script" : "Enable script"}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateRegex.mutate({ id: script.id, enabled: !enabled });
                  }}
                >
                  {enabled ? (
                    <ToggleRight size="0.875rem" className="text-amber-400" />
                  ) : (
                    <ToggleLeft size="0.875rem" />
                  )}
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                  title="Edit script"
                  onClick={() => openRegexDetail(script.id)}
                >
                  <Pencil size="0.8125rem" />
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                  title="Delete script"
                  onClick={async () => {
                    if (
                      await showConfirmDialog({
                        title: "Delete Regex Script",
                        message: `Delete "${script.name}"?`,
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })
                    ) {
                      deleteRegex.mutate(script.id);
                    }
                  }}
                >
                  <Trash2 size="0.8125rem" />
                </button>
              </div>
            );
          })
        )}
      </PanelSection>

      {/* ── Built-in Agents ── */}
      {[
        {
          category: "writer" as AgentCategory,
          title: "Writer Agents",
          icon: <PenLine size="0.8125rem" />,
          desc: "Prose quality, continuity, directions, and narrative flow.",
        },
        {
          category: "tracker" as AgentCategory,
          title: "Tracker Agents",
          icon: <Radar size="0.8125rem" />,
          desc: "Track world state, expressions, quests, backgrounds, and characters.",
        },
        {
          category: "misc" as AgentCategory,
          title: "Misc Agents",
          icon: <Puzzle size="0.8125rem" />,
          desc: "Utilities, combat, illustrations, and other helpers.",
        },
      ].map(({ category, title, icon, desc }) => {
        const agents = BUILT_IN_AGENTS.filter((a) => a.category === category);
        return (
          <PanelSection key={category} title={title} icon={icon}>
            <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">{desc}</div>
            {!agents.length ? (
              <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No agents in this category.</p>
            ) : (
              agents.map((agent) => {
                const config = agentConfigByType.get(agent.id);
                return renderAgentCard({
                  id: config?.id ?? agent.id,
                  type: agent.id,
                  name: agent.name,
                  description: agent.description,
                  category: agent.category,
                  custom: false,
                  imagePath: config?.imagePath ?? null,
                  imageFilename: config?.imageFilename ?? null,
                  enabled: agentEnabledFlag(config?.enabled, agent.enabledByDefault),
                  onToggle: (enabled) => setAgentEnabled.mutate({ agentType: agent.id, enabled }),
                  onImagePick: () => handlePickAgentImage({ id: config?.id, agentType: agent.id }),
                  openAgentDetail,
                });
              })
            )}
          </PanelSection>
        );
      })}

      <PanelSection
        title="Custom Agents"
        icon={<Sparkles size="0.8125rem" />}
        action={
          <button
            onClick={handleCreateAgent}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
            title="Create custom agent"
          >
            <Plus size="0.8125rem" />
          </button>
        }
      >
        <div className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">
          Create your own AI agents with custom instructions and settings.
        </div>
        {!customAgents.length ? (
          <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1 py-2">No custom agents yet.</p>
        ) : (
          customAgents.map((agent) => {
            const enabled = agentEnabledFlag(agent.enabled, true);
            return (
              <div
                key={agent.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
                  !enabled && "opacity-50",
                )}
              >
                <AgentImageButton
                  imagePath={agent.imagePath}
                  imageFilename={agent.imageFilename}
                  onImagePick={() => handlePickAgentImage({ id: agent.id })}
                />
                <button className="min-w-0 flex-1 text-left" onClick={() => openAgentDetail(agent.id)}>
                  <div className="text-xs font-medium font-mono">{agent.name}</div>
                  <div className="text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
                    {agent.description || "No description"}
                  </div>
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                  title={enabled ? "Disable agent" : "Enable agent"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setAgentEnabled.mutate({ agentType: agent.type, enabled: !enabled });
                  }}
                >
                  {enabled ? (
                    <ToggleRight size="0.875rem" className="text-amber-400" />
                  ) : (
                    <ToggleLeft size="0.875rem" />
                  )}
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                  title="Edit agent"
                  onClick={() => openAgentDetail(agent.id)}
                >
                  <Pencil size="0.8125rem" />
                </button>
                <button
                  className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                  title="Delete agent"
                  onClick={async () => {
                    if (
                      await showConfirmDialog({
                        title: "Delete Agent",
                        message: `Delete "${agent.name}"?`,
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })
                    ) {
                      deleteAgent.mutate(agent.id);
                    }
                  }}
                >
                  <Trash2 size="0.8125rem" />
                </button>
              </div>
            );
          })
        )}
      </PanelSection>

      {/* ── Custom Function Tools ── */}
      <PanelSection
        title="Custom Tools"
        icon={<Wrench size="0.8125rem" />}
        action={
          <button
            onClick={handleCreateTool}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
            title="Create custom tool"
          >
            <Plus size="0.8125rem" />
          </button>
        }
      >
        <div className="text-[0.625rem] text-[var(--muted-foreground)] mb-1.5">
          Define custom functions the AI can call during generation (webhook or static).
        </div>
        {!customTools || (customTools as CustomToolRow[]).length === 0 ? (
          <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1 py-2">No custom tools yet.</p>
        ) : (
          (customTools as CustomToolRow[]).map((tool) => (
            <div
              key={tool.id}
              className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              <Wrench size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
              <button className="min-w-0 flex-1 text-left" onClick={() => openToolDetail(tool.id)}>
                <div className="text-xs font-medium font-mono">{tool.name}</div>
                <div className="text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
                  {tool.description || "No description"}
                </div>
              </button>
              <span className="mt-0.5 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                {tool.executionType}
              </span>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                title="Edit tool"
                onClick={() => openToolDetail(tool.id)}
              >
                <Pencil size="0.8125rem" />
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                title="Delete tool"
                onClick={async () => {
                  if (
                    await showConfirmDialog({
                      title: "Delete Tool",
                      message: `Delete "${tool.name}"?`,
                      confirmLabel: "Delete",
                      tone: "destructive",
                    })
                  ) {
                    deleteTool.mutate(tool.id);
                  }
                }}
              >
                <Trash2 size="0.8125rem" />
              </button>
            </div>
          ))
        )}
      </PanelSection>
    </div>
  );
}

type AgentPanelRow = {
  id: string;
  type: string;
  name: string;
  description: string;
  category: AgentCategory | "custom";
  custom: boolean;
  imagePath?: string | null;
  imageFilename?: string | null;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onImagePick: () => void;
};

function renderAgentCard({
  id,
  type,
  name,
  description,
  category,
  custom,
  imagePath,
  imageFilename,
  enabled,
  onToggle,
  onImagePick,
  openAgentDetail,
}: AgentPanelRow & {
  openAgentDetail: (id: string) => void;
}) {
  return (
    <div
      key={id}
      className={cn(
        "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
        !enabled && "opacity-50",
      )}
    >
      <AgentImageButton imagePath={imagePath} imageFilename={imageFilename} onImagePick={onImagePick} />
      <button className="min-w-0 flex-1 text-left" onClick={() => openAgentDetail(custom ? id : type)}>
        <div className="truncate text-xs font-medium font-mono">{name}</div>
        <div className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
          {description || "No description"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[0.5625rem] uppercase tracking-wide text-[var(--muted-foreground)]/80">
            {custom ? "custom" : category}
          </span>
        </div>
      </button>
      <button
        className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
        title={enabled ? "Disable agent" : "Enable agent"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(!enabled);
        }}
      >
        {enabled ? <ToggleRight size="0.875rem" className="text-amber-400" /> : <ToggleLeft size="0.875rem" />}
      </button>
      <button
        className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
        title="Edit agent"
        onClick={() => openAgentDetail(custom ? id : type)}
      >
        <Pencil size="0.8125rem" />
      </button>
    </div>
  );
}

function AgentImageButton({
  imagePath,
  imageFilename,
  onImagePick,
}: {
  imagePath?: string | null;
  imageFilename?: string | null;
  onImagePick: () => void;
}) {
  const [resolvedImagePath, setResolvedImagePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedImagePath(null);
    if (!imagePath && !imageFilename) return;
    resolveEntityImageUrl("agents", imagePath, imageFilename)
      .then((url) => {
        if (!cancelled) setResolvedImagePath(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedImagePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [imageFilename, imagePath]);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onImagePick();
      }}
      className={cn(
        "group/avatar relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-[var(--primary)] transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-400/50",
        resolvedImagePath ? "bg-[var(--muted)]" : "bg-[var(--secondary)]",
      )}
      title={imagePath ? "Replace agent picture" : "Upload agent picture"}
      aria-label={imagePath ? "Replace agent picture" : "Upload agent picture"}
    >
      {resolvedImagePath ? (
        <img src={resolvedImagePath} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <Sparkles size="0.875rem" />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover/avatar:opacity-100">
        <Camera size="0.75rem" className="text-white" />
      </span>
    </button>
  );
}

// ── Collapsible section ──
function PanelSection({
  title,
  icon,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--border)] pb-1 mb-1 last:border-b-0">
      <div className="flex items-center gap-1.5 px-1 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1.5 text-left">
          <span className="text-[var(--muted-foreground)]">{icon}</span>
          <span className="text-[0.6875rem] font-semibold">{title}</span>
          <ChevronDown
            size="0.6875rem"
            className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
          />
        </button>
        {action}
      </div>
      {open && <div className="px-0.5">{children}</div>}
    </div>
  );
}
