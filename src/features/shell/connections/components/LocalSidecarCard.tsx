import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, ChevronUp, Download, Link, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { getDefaultAgentPrompt } from "../../../../engine/contracts/constants/agent-prompts";
import { BUILT_IN_AGENTS } from "../../../../engine/contracts/types/agent";
import {
  LOCAL_SIDECAR_CONNECTION_ID,
  type LocalSidecarStatusResponse,
} from "../../../../engine/contracts/types/sidecar";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { cn } from "../../../../shared/lib/utils";
import {
  agentKeys,
  useAgentConfigs,
  useCreateAgent,
  useUpdateAgent,
  type AgentConfigRow,
} from "../../../catalog/agents";
import { connectionKeys } from "../../../catalog/connections";
import { LocalSidecarSetupModal } from "./LocalSidecarSetupModal";

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "";
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(0)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function progressPercent(downloaded: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}

function runtimeVariantLabel(variant: string | null | undefined): string | null {
  return variant ? variant.replace(/-/g, " ") : null;
}

type TrackerAssignmentSummary = {
  status: "complete" | "partial";
  changedAgents: string[];
  alreadyLocalAgents: string[];
  failedAgents: Array<{ name: string; message: string }>;
};

export function LocalSidecarCard() {
  const queryClient = useQueryClient();
  const { data: agentConfigs } = useAgentConfigs();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const [status, setStatus] = useState<LocalSidecarStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [assigningTrackers, setAssigningTrackers] = useState(false);
  const [trackerAssignmentSummary, setTrackerAssignmentSummary] = useState<TrackerAssignmentSummary | null>(null);

  const applyStatus = useCallback(
    (next: LocalSidecarStatusResponse) => {
      setStatus(next);
      void queryClient.invalidateQueries({ queryKey: connectionKeys.list() });
    },
    [queryClient],
  );

  const refreshStatus = useCallback(async () => {
    const next = await localSidecarApi.status();
    applyStatus(next);
    return next;
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    localSidecarApi
      .status()
      .then((next) => {
        if (!cancelled) applyStatus(next);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Failed to load Local AI Model status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatus]);

  useEffect(() => {
    const active =
      status?.download?.status === "downloading" ||
      status?.status === "downloading_runtime" ||
      status?.status === "downloading_model" ||
      status?.status === "starting";
    if (!active) return;
    const timer = window.setInterval(() => {
      void refreshStatus().catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, status?.download?.status, status?.status]);

  const trackerAgents = useMemo(() => BUILT_IN_AGENTS.filter((agent) => agent.category === "tracker"), []);
  const trackerLocalCount = useMemo(() => {
    const rows = ((agentConfigs ?? []) as AgentConfigRow[]).filter((agent) =>
      trackerAgents.some((tracker) => tracker.id === agent.type),
    );
    return rows.filter((agent) => agent.connectionId === LOCAL_SIDECAR_CONNECTION_ID).length;
  }, [agentConfigs, trackerAgents]);

  const hasModel = !!status?.modelDownloaded;
  const hasRuntime = !!status?.runtime?.installed || !!status?.config.executablePath?.trim();
  const isDownloading = status?.download?.status === "downloading";
  const isRuntimeBusy = status?.status === "downloading_runtime" || status?.status === "starting";
  const canAssignTrackers =
    !!status && hasModel && hasRuntime && !isDownloading && !isRuntimeBusy && status.status !== "server_error";
  const downloadPercent = progressPercent(status?.download?.downloaded ?? 0, status?.download?.total ?? 0);
  const modelSummary = hasModel
    ? `${status?.modelDisplayName ?? "Model"} - GGUF${status?.modelSize ? ` - ${formatBytes(status.modelSize)}` : ""}`
    : "Not downloaded";
  const runtimeSummary = hasRuntime
    ? status?.runtime?.installed
      ? (runtimeVariantLabel(status.runtime.variant) ?? "runtime installed")
      : "custom executable"
    : "runtime not installed";
  const statusSuffix = status?.ready
    ? " - Ready"
    : status?.status === "starting"
      ? " - Starting"
      : status?.status === "server_error"
        ? " - Error"
        : "";

  const openSetup = () => {
    void refreshStatus().catch(() => {});
    setSetupOpen(true);
  };

  const handleDownloadNow = async () => {
    if (isDownloading) return;
    // LEGACY_PARITY: local-sidecar-quick-start - Compact card uses Q4_K_M as the fast default download.
    const quantization =
      status?.curatedModels.find((model) => model.quantization === "q4_k_m")?.quantization ??
      status?.curatedModels[0]?.quantization ??
      "q4_k_m";

    setBusy("download-now");
    try {
      const next = await localSidecarApi.downloadCurated(quantization);
      applyStatus(next);
      setExpanded(true);
      toast.success("Model download started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start local model download");
      await refreshStatus().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const handleToggleEnabled = async () => {
    if (!status) return;
    setBusy("enabled");
    try {
      const next = await localSidecarApi.updateConfig({ enabled: !status.config.enabled });
      applyStatus(next);
      toast.success(next.config.enabled ? "Local Model connection enabled" : "Local Model connection hidden");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update Local Model connection");
    } finally {
      setBusy(null);
    }
  };

  const handleAssignTrackersToLocal = async () => {
    if (assigningTrackers) return;
    if (!canAssignTrackers) {
      toast.error("Finish Local Model setup and make sure the sidecar can start before assigning trackers");
      return;
    }
    setAssigningTrackers(true);
    setTrackerAssignmentSummary(null);
    try {
      let readyStatus = status;
      if (!readyStatus.config.enabled) {
        readyStatus = await localSidecarApi.updateConfig({ enabled: true });
        applyStatus(readyStatus);
      }
      if (!readyStatus.ready) {
        readyStatus = await localSidecarApi.start();
        applyStatus(readyStatus);
      }
      if (!readyStatus.ready) {
        throw new Error("Local Model sidecar is not ready yet");
      }

      const configs = await queryClient.fetchQuery({
        queryKey: agentKeys.all,
        queryFn: () => storageApi.list<AgentConfigRow>("agents"),
        staleTime: 0,
      });
      const configByType = new Map(configs.map((config) => [config.type, config]));
      const alreadyLocalAgents: string[] = [];
      const changedAgents: string[] = [];
      const failedAgents: Array<{ name: string; message: string }> = [];

      for (const agent of trackerAgents) {
        try {
          const existing = configByType.get(agent.id);
          if (existing) {
            if (existing.connectionId === LOCAL_SIDECAR_CONNECTION_ID) {
              alreadyLocalAgents.push(agent.name);
              continue;
            }
            await updateAgent.mutateAsync({ id: existing.id, connectionId: LOCAL_SIDECAR_CONNECTION_ID });
            changedAgents.push(agent.name);
            continue;
          }

          await createAgent.mutateAsync({
            type: agent.id,
            name: agent.name,
            description: agent.description,
            phase: agent.phase,
            enabled: true,
            connectionId: LOCAL_SIDECAR_CONNECTION_ID,
            promptTemplate: getDefaultAgentPrompt(agent.id),
            settings: {},
          });
          changedAgents.push(agent.name);
        } catch (error) {
          failedAgents.push({
            name: agent.name,
            message: error instanceof Error ? error.message : "Update failed",
          });
        }
      }

      await queryClient.invalidateQueries({ queryKey: agentKeys.all });
      await queryClient.refetchQueries({ queryKey: agentKeys.all, type: "active" });
      if (failedAgents.length > 0) {
        setTrackerAssignmentSummary({
          status: "partial",
          changedAgents,
          alreadyLocalAgents,
          failedAgents,
        });
        const changedSummary = changedAgents.length > 0 ? `Updated: ${changedAgents.join(", ")}. ` : "";
        const alreadyLocalSummary =
          alreadyLocalAgents.length > 0 ? `Already local: ${alreadyLocalAgents.join(", ")}. ` : "";
        toast.warning(
          `${changedSummary}${alreadyLocalSummary}Failed: ${failedAgents.map((agent) => agent.name).join(", ")}.`,
        );
        return;
      }
      setTrackerAssignmentSummary({
        status: "complete",
        changedAgents,
        alreadyLocalAgents,
        failedAgents,
      });
      toast.success(
        changedAgents.length > 0
          ? `Updated ${changedAgents.length} tracker agent(s) for the local model`
          : "Tracker agents already point to the local model",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tracker agent connections");
    } finally {
      setAssigningTrackers(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-400/5 to-blue-500/5 p-3 transition-all",
          expanded && "border-sky-400/30",
        )}
      >
        <div
          className={cn("flex items-center gap-2.5", !hasModel && "cursor-pointer")}
          onClick={() => {
            if (!hasModel) setExpanded(true);
          }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-sm">
            <BrainCircuit size="1rem" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Local Model</div>
            <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
              {loading ? "Loading" : `${modelSummary}${hasModel ? ` - ${runtimeSummary}${statusSuffix}` : ""}`}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {loading && <Loader2 size="0.8125rem" className="animate-spin text-[var(--muted-foreground)]" />}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openSetup();
              }}
              className="rounded-lg p-1.5 text-sky-400 transition-all hover:bg-sky-400/15 active:scale-90"
              title="Open local model settings"
            >
              <Settings2 size="0.8125rem" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
              className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronUp size="0.875rem" /> : <ChevronDown size="0.875rem" />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-2.5 border-t border-sky-400/10 pt-2.5">
            {!hasModel ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadNow()}
                  disabled={busy === "download-now" || isDownloading}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-400/15 px-3 py-2 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === "download-now" || isDownloading ? (
                    <Loader2 size="0.8125rem" className="animate-spin" />
                  ) : (
                    <Download size="0.8125rem" />
                  )}
                  {busy === "download-now" || isDownloading ? "Downloading..." : "Download now"}
                </button>
                <button
                  type="button"
                  onClick={openSetup}
                  className="text-center text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  Choose model options
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleToggleEnabled}
                  disabled={busy === "enabled"}
                  className="flex items-center gap-2.5 text-left"
                >
                  <div className="relative shrink-0">
                    <div
                      className={cn(
                        "h-4 w-7 rounded-full transition-colors",
                        status?.config.enabled ? "bg-sky-400/70" : "bg-[var(--border)]",
                      )}
                    />
                    <div
                      className={cn(
                        "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
                        status?.config.enabled && "translate-x-3",
                      )}
                    />
                  </div>
                  <span className="text-xs text-[var(--muted-foreground)]">Use as a connection option</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleAssignTrackersToLocal()}
                  disabled={assigningTrackers || !canAssignTrackers}
                  className="flex items-center justify-between gap-3 rounded-lg border border-sky-400/15 bg-sky-400/8 px-3 py-2 text-left transition-all hover:bg-sky-400/12 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-sky-200">Assign local model to tracker agents</div>
                    <div className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                      {trackerLocalCount}/{trackerAgents.length} built-in tracker agents currently point here. Partial
                      failures are reported by agent.
                    </div>
                  </div>
                  {assigningTrackers ? (
                    <Loader2 size="0.875rem" className="animate-spin text-sky-300" />
                  ) : (
                    <Link size="0.875rem" className="text-sky-300" />
                  )}
                </button>
                {trackerAssignmentSummary && (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-[0.6875rem]",
                      trackerAssignmentSummary.status === "partial"
                        ? "border-amber-500/20 bg-amber-500/5 text-amber-100"
                        : "border-emerald-500/20 bg-emerald-500/5 text-emerald-100",
                    )}
                  >
                    <div className="font-medium">
                      {trackerAssignmentSummary.status === "partial"
                        ? "Partial tracker assignment"
                        : "Tracker assignment complete"}
                    </div>
                    {trackerAssignmentSummary.changedAgents.length > 0 && (
                      <div className="mt-1 text-[var(--muted-foreground)]">
                        Updated: {trackerAssignmentSummary.changedAgents.join(", ")}
                      </div>
                    )}
                    {trackerAssignmentSummary.alreadyLocalAgents.length > 0 && (
                      <div className="mt-1 text-[var(--muted-foreground)]">
                        Already local: {trackerAssignmentSummary.alreadyLocalAgents.join(", ")}
                      </div>
                    )}
                    {trackerAssignmentSummary.failedAgents.length > 0 && (
                      <div className="mt-1 text-[var(--muted-foreground)]">
                        Failed:{" "}
                        {trackerAssignmentSummary.failedAgents
                          .map((agent) => `${agent.name} (${agent.message})`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {status?.download && (
              <div className="mt-2.5 rounded-lg border border-[var(--border)]/50 bg-[var(--background)]/60 p-2">
                <div className="flex items-center justify-between gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                  <span className="truncate">{status.download.label ?? status.download.phase}</span>
                  <span>{status.download.total ? `${downloadPercent}%` : status.download.status}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                  <div
                    className="h-full bg-sky-400 transition-all"
                    style={{ width: `${isDownloading && !status.download.total ? 35 : downloadPercent}%` }}
                  />
                </div>
                {status.download.error && (
                  <div className="mt-1 text-[0.6875rem] text-red-300">{status.download.error}</div>
                )}
              </div>
            )}

            {status?.startupError && (
              <div className="mt-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                <div className="text-[0.6875rem] font-medium text-amber-200">Local runtime unavailable</div>
                <div className="mt-1 text-[0.6875rem] text-[var(--muted-foreground)]/75">{status.startupError}</div>
                <button
                  type="button"
                  onClick={openSetup}
                  className="mt-2 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[0.6875rem] font-medium text-amber-200 transition-colors hover:bg-amber-500/25"
                >
                  Open Local AI Model
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <LocalSidecarSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        status={status}
        onStatus={applyStatus}
        refreshStatus={refreshStatus}
      />
    </>
  );
}
