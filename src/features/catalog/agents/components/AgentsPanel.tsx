// ──────────────────────────────────────────────
// Panel: Agents & Tools
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Camera,
  Sparkles,
  Pencil,
  Plus,
  Search,
  Wrench,
  ChevronDown,
  Trash2,
  PenLine,
  Radar,
  Puzzle,
  ToggleLeft,
  ToggleRight,
  Download,
} from "lucide-react";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  agentEnabledFlag,
  agentKeys,
  useAgentConfigs,
  useCreateAgent,
  useDeleteAgent,
  useSetAgentEnabledByType,
  useUploadAgentImage,
  type AgentConfigRow,
} from "../hooks/use-agents";
import { useCustomTools, useDeleteCustomTool, type CustomToolRow } from "../hooks/use-custom-tools";
import { BUILT_IN_AGENTS, type AgentCategory } from "../../../../engine/contracts/types/agent";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { resolveEntityImageUrl } from "../../../../shared/api/local-file-api";
import { cn } from "../../../../shared/lib/utils";
import { commitAgentImportBatch, type AgentImportBatchResult, type StagedAgentImportPayload } from "../lib/agent-import-batch";
import { normalizeAgentImportPayloads } from "../lib/agent-import-export";

function formatImportFailureDescription(failures: string[]): string {
  const visible = failures.slice(0, 4);
  const hidden = failures.length - visible.length;
  return hidden > 0
    ? `${visible.join("\n")}\n${hidden} more failed. Full details are shown in the panel.`
    : visible.join("\n");
}

function formatImportBatchDetails(result: AgentImportBatchResult): string[] {
  return result.outcomes.map((outcome) => {
    switch (outcome.status) {
      case "imported":
        return `${outcome.fileName} / ${outcome.name}: imported (${outcome.id})`;
      case "failed":
        return `${outcome.fileName} / ${outcome.name}: failed: ${outcome.message}`;
      case "rolled_back":
        return `${outcome.fileName} / ${outcome.name}: rolled back after batch failure (${outcome.id})`;
      case "rollback_failed":
        return `${outcome.fileName} / ${outcome.name}: kept after rollback failed (${outcome.id}): ${outcome.message}`;
      case "not_attempted":
        return `${outcome.fileName} / ${outcome.name}: ${outcome.message}`;
    }
  });
}

export function AgentsPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: agentConfigs, isLoading } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const createAgent = useCreateAgent();
  const deleteAgent = useDeleteAgent();
  const deleteTool = useDeleteCustomTool();
  const setAgentEnabled = useSetAgentEnabledByType();
  const uploadAgentImage = useUploadAgentImage();
  const openAgentDetail = useUIStore((s) => s.openAgentDetail);
  const openToolDetail = useUIStore((s) => s.openToolDetail);
  const agentImageInputRef = useRef<HTMLInputElement>(null);
  const agentImportInputRef = useRef<HTMLInputElement>(null);
  const agentImageTargetRef = useRef<{ id?: string; agentType?: string } | null>(null);
  const [importFailureDetails, setImportFailureDetails] = useState<string[]>([]);

  const agentConfigRows = useMemo(() => (agentConfigs ?? []) as AgentConfigRow[], [agentConfigs]);
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
  const customToolRows = useMemo(() => (customTools ?? []) as CustomToolRow[], [customTools]);
  const searchQuery = search.trim().toLowerCase();
  const searchActive = searchQuery.length > 0;
  const matchesSearch = useCallback(
    (values: Array<string | null | undefined>) => {
      if (!searchQuery) return true;
      return values.some((value) => (value ?? "").toLowerCase().includes(searchQuery));
    },
    [searchQuery],
  );
  const visibleCustomAgents = useMemo(
    () =>
      customAgents
        .filter((agent) => matchesSearch([agent.name, agent.description, agent.type, "custom"]))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [customAgents, matchesSearch],
  );
  const visibleCustomTools = useMemo(
    () => customToolRows.filter((tool) => matchesSearch([tool.name, tool.description, tool.executionType])),
    [customToolRows, matchesSearch],
  );
  const agentSections = useMemo(
    () => [
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
    ],
    [],
  );
  const visibleBuiltInCount = useMemo(
    () => BUILT_IN_AGENTS.filter((agent) => matchesSearch([agent.name, agent.description, agent.category])).length,
    [matchesSearch],
  );
  const hasVisibleResults = visibleBuiltInCount > 0 || visibleCustomAgents.length > 0 || visibleCustomTools.length > 0;

  const handleCreateAgent = () => {
    // Create a new custom agent immediately in DB then open editor
    openAgentDetail("__new__");
  };

  const handleImportAgents = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (!files.length) return;
      setImportFailureDetails([]);

      const failures: string[] = [];
      let stagedPayloads: StagedAgentImportPayload[] = [];
      const usedTypes = new Set(agentConfigRows.map((agent) => agent.type).filter(Boolean));
      for (const file of files) {
        try {
          const json = JSON.parse(await file.text());
          const payloads = normalizeAgentImportPayloads(json, usedTypes);
          stagedPayloads.push(...payloads.map((payload) => ({ fileName: file.name, payload })));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to import agent";
          failures.push(`${file.name}: ${message}`);
        }
      }

      const stagedTypeOwners = new Map<string, StagedAgentImportPayload>();
      const uniqueStagedPayloads: StagedAgentImportPayload[] = [];
      for (const staged of stagedPayloads) {
        const existing = stagedTypeOwners.get(staged.payload.type);
        if (existing) {
          failures.push(
            `${staged.fileName} / ${staged.payload.name}: duplicate agent type "${staged.payload.type}" also appears in ${existing.fileName} / ${existing.payload.name}`,
          );
        } else {
          stagedTypeOwners.set(staged.payload.type, staged);
          uniqueStagedPayloads.push(staged);
        }
      }
      stagedPayloads = uniqueStagedPayloads;

      // Every selected file has been scanned; this return only fires when
      // there is no valid payload left to commit.
      if (stagedPayloads.length === 0) {
        setImportFailureDetails(failures);
        toast.error(`${failures.length} agent import file${failures.length === 1 ? "" : "s"} failed`, {
          description: formatImportFailureDescription(failures),
        });
        return;
      }

      const result = await commitAgentImportBatch(
        stagedPayloads,
        (payload) => createAgent.mutateAsync(payload) as Promise<{ id?: unknown }>,
        (id) => deleteAgent.mutateAsync(id),
      );

      const batchDetails = formatImportBatchDetails(result);
      const detailLines = [...failures, ...batchDetails];
      const failedCount = failures.length + result.failures.length;
      if (failedCount > 0) {
        setImportFailureDetails(detailLines);
        const keptAfterRollback = result.kept.length;
        if (!result.atomic) {
          await qc.invalidateQueries({ queryKey: agentKeys.all });
          toast.error(
            `Agent import requires cleanup: ${keptAfterRollback} kept after rollback failed`,
            {
              description: formatImportFailureDescription(detailLines),
            },
          );
        } else if (result.imported > 0) {
          toast.warning(`Agent import partially completed: ${result.imported} imported`, {
            description: formatImportFailureDescription(detailLines),
          });
        } else {
          toast.error(`${failedCount} agent import${failedCount === 1 ? "" : "s"} failed`, {
            description: formatImportFailureDescription(detailLines),
          });
        }
        return;
      }

      if (result.imported > 0) {
        setImportFailureDetails([]);
        toast.success(`Imported ${result.imported} agent${result.imported === 1 ? "" : "s"}`);
      }
    },
    [agentConfigRows, createAgent, deleteAgent, qc],
  );

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

  return (
    <div className="flex flex-col gap-1 p-3">
      <input
        ref={agentImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAgentImageSelected}
      />
      <input
        ref={agentImportInputRef}
        type="file"
        accept=".json,.marinara-agent.json,application/json"
        multiple
        className="hidden"
        onChange={handleImportAgents}
      />

      <div className="mb-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size="0.8125rem"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search agents and tools..."
            className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-7 pr-2 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-amber-400/60"
          />
        </div>
        <button
          type="button"
          onClick={() => agentImportInputRef.current?.click()}
          disabled={createAgent.isPending}
          className="flex h-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-amber-400/50 hover:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
          title="Import custom agent"
        >
          <Download size="0.8125rem" />
        </button>
        <button
          type="button"
          onClick={handleCreateAgent}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-violet-500 px-2.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          title="Create custom agent"
        >
          <Plus size="0.8125rem" />
          <span>New</span>
        </button>
      </div>

      {importFailureDetails.length > 0 && (
        <div className="mb-2 rounded-lg border border-red-500/25 bg-red-500/10 p-2.5 text-xs text-red-100">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {importFailureDetails.length} import failure{importFailureDetails.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setImportFailureDetails([])}
              className="shrink-0 rounded-md px-2 py-1 text-[0.625rem] font-medium text-red-100/70 transition-colors hover:bg-red-500/15 hover:text-red-100"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[0.625rem] leading-relaxed text-red-100/85">
            {importFailureDetails.map((failure, index) => (
              <div key={`${index}-${failure}`}>{failure}</div>
            ))}
          </div>
        </div>
      )}

      {isLoading && <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">Loading...</div>}

      {searchActive && !hasVisibleResults && (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
          No agents or tools match your search.
        </div>
      )}

      {agentSections.map(({ category, title, icon, desc }) => {
        const agents = BUILT_IN_AGENTS.filter(
          (agent) => agent.category === category && matchesSearch([agent.name, agent.description, agent.category]),
        );
        if (searchActive && agents.length === 0) {
          return null;
        }

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

      {(!searchActive || visibleCustomAgents.length > 0) && (
        <PanelSection title="Custom Agents" icon={<Sparkles size="0.8125rem" />}>
          <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
            Create your own AI agents with custom instructions and settings.
          </div>
          {!customAgents.length ? (
            <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No custom agents yet.</p>
          ) : (
            visibleCustomAgents.map((agent) => {
              const enabled = agentEnabledFlag(agent.enabled, true);
              return renderAgentCard({
                id: agent.id,
                type: agent.type,
                name: agent.name,
                description: agent.description,
                category: "custom",
                custom: true,
                imagePath: agent.imagePath,
                imageFilename: agent.imageFilename,
                enabled,
                onToggle: (nextEnabled) => setAgentEnabled.mutate({ agentType: agent.type, enabled: nextEnabled }),
                onImagePick: () => handlePickAgentImage({ id: agent.id }),
                openAgentDetail,
              });
            })
          )}
        </PanelSection>
      )}

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
        <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
          Define custom functions the AI can call during generation (webhook or static).
        </div>
        {!customToolRows.length ? (
          <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No custom tools yet.</p>
        ) : visibleCustomTools.length === 0 ? (
          <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No custom tools match your search.</p>
        ) : (
          visibleCustomTools.map((tool) => (
            <div
              key={tool.id}
              className="group relative flex items-center gap-2.5 rounded-xl p-2.5 transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--primary)]">
                <Wrench size="0.875rem" />
              </span>
              <button className="min-w-0 flex-1 pr-16 text-left" onClick={() => openToolDetail(tool.id)}>
                <div className="truncate text-xs font-medium font-mono">{tool.name}</div>
                <div className="text-[0.625rem] text-[var(--muted-foreground)] line-clamp-2">
                  {tool.description || "No description"}
                </div>
                <span className="mt-1 inline-flex rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                  {tool.executionType}
                </span>
              </button>
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                <button
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
                  title="Edit tool"
                  onClick={() => openToolDetail(tool.id)}
                >
                  <Pencil size="0.8125rem" />
                </button>
                <button
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--destructive)]"
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
        "group relative flex items-center gap-2.5 rounded-xl p-2.5 transition-colors hover:bg-[var(--sidebar-accent)]",
        !enabled && "opacity-50",
      )}
    >
      <AgentImageButton imagePath={imagePath} imageFilename={imageFilename} onImagePick={onImagePick} />
      <button
        className="min-w-0 flex-1 pr-20 text-left"
        onClick={() => openAgentDetail(custom ? id : type)}
      >
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
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
        <button
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
          title={enabled ? "Disable agent" : "Enable agent"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(!enabled);
          }}
        >
          {enabled ? <ToggleRight size="0.875rem" className="text-amber-400" /> : <ToggleLeft size="0.875rem" />}
        </button>
        <button
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
          title="Edit agent"
          onClick={(event) => {
            event.stopPropagation();
            openAgentDetail(custom ? id : type);
          }}
        >
          <Pencil size="0.8125rem" />
        </button>
      </div>
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
        "group/avatar relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-[var(--primary)] transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-400/50",
        resolvedImagePath ? "bg-[var(--muted)]" : "bg-[var(--secondary)]",
      )}
      title={imagePath || imageFilename ? "Replace agent picture" : "Upload agent picture"}
      aria-label={imagePath || imageFilename ? "Replace agent picture" : "Upload agent picture"}
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
