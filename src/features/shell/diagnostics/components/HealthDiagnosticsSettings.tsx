import { useMemo, useState } from "react";
import { Activity, Clipboard, Loader2, RefreshCw, ShieldCheck, Stethoscope, Wifi } from "lucide-react";
import { toast } from "sonner";
import { connectionCommandApi } from "../../../../shared/api/connection-command-api";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { recordClientDiagnostic } from "../../../../shared/lib/client-diagnostics";
import { cn } from "../../../../shared/lib/utils";
import { buildTroubleshootingPacket, type DiagnosticItem, type DiagnosticStatus } from "../lib/diagnostics-model";
import { useDiagnosticsSnapshot } from "../hooks/use-diagnostics-snapshot";

type ProbeState = {
  status: "ok" | "error";
  message: string;
};

function statusTone(status: DiagnosticStatus) {
  switch (status) {
    case "ok":
      return "text-emerald-500 bg-emerald-500/10 ring-emerald-500/25";
    case "warning":
    case "degraded":
      return "text-amber-500 bg-amber-500/10 ring-amber-500/25";
    case "error":
      return "text-rose-500 bg-rose-500/10 ring-rose-500/25";
    case "unknown":
      return "text-[var(--muted-foreground)] bg-[var(--secondary)]/55 ring-[var(--border)]";
  }
}

function statusLabel(status: DiagnosticStatus) {
  if (status === "ok") return "Healthy";
  if (status === "error") return "Error";
  if (status === "degraded") return "Degraded";
  if (status === "warning") return "Needs attention";
  return "Unknown";
}

function detailRecord(item: DiagnosticItem): Record<string, unknown> {
  return item.details && typeof item.details === "object" && !Array.isArray(item.details)
    ? (item.details as Record<string, unknown>)
    : {};
}

function latencySummary(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "Probe completed.";
  const latencyMs = (result as { latencyMs?: unknown }).latencyMs;
  return typeof latencyMs === "number" && Number.isFinite(latencyMs) ? `Probe completed in ${latencyMs} ms.` : "Probe completed.";
}

function SectionIcon({ id }: { id: string }) {
  if (id === "runtime") return <Wifi size="0.875rem" aria-hidden="true" />;
  if (id === "sidecar") return <Activity size="0.875rem" aria-hidden="true" />;
  if (id === "providers") return <Stethoscope size="0.875rem" aria-hidden="true" />;
  return <ShieldCheck size="0.875rem" aria-hidden="true" />;
}

export function HealthDiagnosticsSettings() {
  const { snapshot, loading, error, refresh } = useDiagnosticsSnapshot();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [sidecarBusy, setSidecarBusy] = useState(false);
  const [sidecarSmokeResult, setSidecarSmokeResult] = useState<ProbeState | null>(null);
  const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({});
  const [providerProbeResults, setProviderProbeResults] = useState<Record<string, ProbeState>>({});

  const packetText = useMemo(() => {
    if (!snapshot) return "";
    return JSON.stringify(buildTroubleshootingPacket(snapshot), null, 2);
  }, [snapshot]);

  const copyPacket = async () => {
    if (!packetText) return;
    try {
      await navigator.clipboard.writeText(packetText);
      setCopyStatus("copied");
      toast.success("Troubleshooting packet copied");
    } catch (copyError) {
      setCopyStatus("failed");
      toast.error(copyError instanceof Error ? copyError.message : "Failed to copy troubleshooting packet");
    }
  };

  const runSidecarSmokeTest = async () => {
    if (sidecarBusy) return;
    setSidecarBusy(true);
    setSidecarSmokeResult(null);
    try {
      const result = await localSidecarApi.testMessage();
      const message = result.success ? latencySummary(result) : result.error || "Local Model smoke test failed.";
      setSidecarSmokeResult({ status: result.success ? "ok" : "error", message });
      if (!result.success) {
        recordClientDiagnostic({
          level: "error",
          source: "local-sidecar",
          message,
          details: result,
        });
      }
    } catch (smokeError) {
      const message = smokeError instanceof Error ? smokeError.message : "Local Model smoke test failed.";
      setSidecarSmokeResult({ status: "error", message });
      recordClientDiagnostic({
        level: "error",
        source: "local-sidecar",
        message,
        details: smokeError,
      });
    } finally {
      setSidecarBusy(false);
    }
  };

  const runProviderProbe = async (item: DiagnosticItem) => {
    const connectionId = String(detailRecord(item).connectionId ?? "").trim();
    if (!connectionId || providerBusy[connectionId]) return;
    setProviderBusy((current) => ({ ...current, [connectionId]: true }));
    try {
      const result = await connectionCommandApi.test<{ success?: boolean; error?: string; latencyMs?: number }>(connectionId);
      const success = result.success !== false;
      const message = success ? latencySummary(result) : result.error || "Provider probe failed.";
      setProviderProbeResults((current) => ({ ...current, [connectionId]: { status: success ? "ok" : "error", message } }));
      if (!success) {
        recordClientDiagnostic({
          level: "error",
          source: "provider-probe",
          message,
          details: { connectionId, result },
        });
      }
    } catch (probeError) {
      const message = probeError instanceof Error ? probeError.message : "Provider probe failed.";
      setProviderProbeResults((current) => ({ ...current, [connectionId]: { status: "error", message } }));
      recordClientDiagnostic({
        level: "error",
        source: "provider-probe",
        message,
        details: { connectionId, error: probeError },
      });
    } finally {
      setProviderBusy((current) => {
        const { [connectionId]: _finished, ...rest } = current;
        return rest;
      });
    }
  };

  const overall = snapshot?.overallStatus ?? (loading ? "unknown" : "error");

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--foreground)]">Health and Diagnostics</div>
            <div className="mt-0.5 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
              Runtime readiness, setup status, storage reachability, recent client diagnostics, and a redacted packet
              for support.
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--background)]/80 px-2.5 py-1 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 size="0.8125rem" className="animate-spin" /> : <RefreshCw size="0.8125rem" />}
              Refresh
            </button>
          </div>
        </div>

        <div className={cn("rounded-lg px-3 py-2 text-xs ring-1", statusTone(overall))}>
          <span className="font-semibold">{statusLabel(overall)}</span>
          <span className="ml-2 text-[var(--muted-foreground)]">
            {loading
              ? "Checking diagnostics..."
              : error
                ? error
                : snapshot
                  ? `Snapshot generated ${new Date(snapshot.generatedAt).toLocaleString()}.`
                  : "No diagnostics snapshot loaded."}
          </span>
        </div>
      </div>

      {snapshot?.sections.map((section) => (
        <section key={section.id} className="rounded-lg bg-[var(--secondary)]/25 p-2.5 ring-1 ring-[var(--border)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-[var(--muted-foreground)]">
                <SectionIcon id={section.id} />
              </span>
              <h3 className="truncate text-xs font-semibold text-[var(--foreground)]">{section.title}</h3>
            </div>
            <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[0.625rem] font-semibold ring-1", statusTone(section.status))}>
              {statusLabel(section.status)}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {section.items.map((item) => {
              const connectionId = String(detailRecord(item).connectionId ?? "").trim();
              const providerResult = connectionId ? providerProbeResults[connectionId] : null;
              const isSidecar = section.id === "sidecar" && item.id === "local-sidecar";
              return (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-md bg-[var(--background)]/55 p-2 text-xs ring-1 ring-[var(--border)]/70 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">{item.label}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[0.625rem] font-semibold ring-1", statusTone(item.status))}>
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">{item.summary}</p>
                    {isSidecar && sidecarSmokeResult && (
                      <p
                        className={cn(
                          "mt-1 text-[0.6875rem] leading-relaxed",
                          sidecarSmokeResult.status === "ok" ? "text-emerald-500" : "text-rose-500",
                        )}
                      >
                        {sidecarSmokeResult.message}
                      </p>
                    )}
                    {providerResult && (
                      <p
                        className={cn(
                          "mt-1 text-[0.6875rem] leading-relaxed",
                          providerResult.status === "ok" ? "text-emerald-500" : "text-rose-500",
                        )}
                      >
                        {providerResult.message}
                      </p>
                    )}
                  </div>
                  {isSidecar && (
                    <button
                      type="button"
                      onClick={() => void runSidecarSmokeTest()}
                      disabled={sidecarBusy}
                      className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--background)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sidecarBusy ? <Loader2 size="0.75rem" className="animate-spin" /> : <Stethoscope size="0.75rem" />}
                      Run smoke test
                    </button>
                  )}
                  {section.id === "providers" && connectionId && (
                    <button
                      type="button"
                      onClick={() => void runProviderProbe(item)}
                      disabled={!!providerBusy[connectionId]}
                      className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--background)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {providerBusy[connectionId] ? <Loader2 size="0.75rem" className="animate-spin" /> : <Wifi size="0.75rem" />}
                      Probe
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="rounded-lg bg-[var(--secondary)]/25 p-2.5 ring-1 ring-[var(--border)]">
        <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">Recent Diagnostics</div>
        {snapshot && snapshot.recentDiagnostics.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {snapshot.recentDiagnostics.slice(0, 5).map((entry) => (
              <div key={entry.id} className="rounded-md bg-[var(--background)]/55 p-2 text-[0.6875rem] ring-1 ring-[var(--border)]/70">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-[var(--foreground)]">{entry.source}</span>
                  <span className="text-[var(--muted-foreground)]">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-[var(--muted-foreground)]">{entry.message}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No recent client diagnostics recorded.</p>
        )}
      </section>

      <section className="rounded-lg bg-[var(--secondary)]/25 p-2.5 ring-1 ring-[var(--border)]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-[var(--foreground)]">Troubleshooting Packet</div>
            <div className="mt-0.5 text-[0.6875rem] text-[var(--muted-foreground)]">
              Copy a redacted JSON packet for support.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void copyPacket()}
            disabled={!packetText}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[0.6875rem] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Clipboard size="0.75rem" />
            {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy packet"}
          </button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-md bg-[var(--background)]/75 p-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)] ring-1 ring-[var(--border)]/70">
          {packetText || "Diagnostics packet will appear after the first snapshot finishes."}
        </pre>
      </section>
    </div>
  );
}
