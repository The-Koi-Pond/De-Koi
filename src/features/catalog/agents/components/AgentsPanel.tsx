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
  PenLine,
  Radar,
  Puzzle,
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
import { BUILT_IN_AGENTS, type AgentCategory } from "../../../../engine/contracts/types/agent";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { resolveEntityImageUrl } from "../../../../shared/api/local-file-api";
import { cn } from "../../../../shared/lib/utils";

export function AgentsPanel() {
  const { data: agentConfigs, isLoading } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const deleteAgent = useDeleteAgent();
  const deleteTool = useDeleteCustomTool();
  const setAgentEnabled = useSetAgentEnabledByType();
  const uploadAgentImage = useUploadAgentImage();
  const openAgentDetail = useUIStore((s) => s.openAgentDetail);
  const openToolDetail = useUIStore((s) => s.openToolDetail);
  const agentImageInputRef = useRef<HTMLInputElement>(null);
  const agentImageTargetRef = useRef<{ id?: string; agentType?: string } | null>(null);

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
