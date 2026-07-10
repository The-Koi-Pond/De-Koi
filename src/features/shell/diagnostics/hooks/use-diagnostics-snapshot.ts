import { useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "../../../../engine/contracts/constants/defaults";
import type { StorageEntity } from "../../../../engine/capabilities/storage";
import type { LocalSidecarStatusResponse } from "../../../../engine/contracts/types/sidecar";
import { checkRemoteRuntimeHealth, hasEmbeddedTauriRuntime } from "../../../../shared/api/remote-runtime";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { getRecentClientDiagnostics, recordClientDiagnostic } from "../../../../shared/lib/client-diagnostics";
import { getBrowserPlatformInfo } from "../../../../shared/lib/support-report";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  buildGenerationTimingSection,
  diagnosticsOverallStatus,
  type DiagnosticItem,
  type DiagnosticsLogTail,
  type DiagnosticsRuntimeMode,
  type DiagnosticsSection,
  type DiagnosticsSnapshot,
  type DiagnosticStatus,
} from "../lib/diagnostics-model";

type ConnectionSummary = {
  id?: string;
  name?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
};

const STORAGE_CHECKS: Array<{ entity: StorageEntity; label: string }> = [
  { entity: "chats", label: "Chats" },
  { entity: "messages", label: "Messages" },
  { entity: "characters", label: "Characters" },
  { entity: "personas", label: "Personas" },
  { entity: "lorebooks", label: "Lorebooks" },
  { entity: "prompts", label: "Prompt presets" },
  { entity: "connections", label: "Connections" },
  { entity: "app-settings", label: "App settings" },
];

const CONNECTION_SUMMARY_OPTIONS = {
  fields: ["id", "name", "provider", "model", "baseUrl"],
  limit: 100,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function section(id: string, title: string, items: DiagnosticItem[]): DiagnosticsSection {
  return {
    id,
    title,
    status: diagnosticsOverallStatus(items),
    items,
  };
}

function runtimeMode(remoteRuntimeUrl: string): DiagnosticsRuntimeMode {
  if (hasEmbeddedTauriRuntime()) return "embedded";
  return remoteRuntimeUrl.trim() ? "remote" : "web-shell";
}

async function runtimeSection(remoteRuntimeUrl: string): Promise<DiagnosticsSection> {
  if (hasEmbeddedTauriRuntime()) {
    return section("runtime", "Runtime", [
      {
        id: "embedded-runtime",
        label: "Embedded runtime",
        status: "ok",
        summary: "Embedded Tauri runtime active.",
        details: { runtimeMode: "embedded" },
      },
    ]);
  }

  const url = remoteRuntimeUrl.trim();
  if (!url) {
    return section("runtime", "Runtime", [
      {
        id: "remote-runtime",
        label: "Remote runtime",
        status: "error",
        summary: "Remote Runtime URL is required in web-shell mode.",
      },
    ]);
  }

  const result = await checkRemoteRuntimeHealth(url);
  const status: DiagnosticStatus =
    result.status === "ok" ? "ok" : result.status === "not-writable" || result.status === "unconfigured" ? "warning" : "error";
  return section("runtime", "Runtime", [
    {
      id: "remote-runtime",
      label: "Remote runtime",
      status,
      summary: result.message,
      details: result,
    },
  ]);
}

function sidecarStatus(status: LocalSidecarStatusResponse): DiagnosticStatus {
  if (!status.configured) return "unknown";
  if (status.ready && status.status === "ready") return "ok";
  if (status.status === "server_error") return "error";
  if (status.status === "starting" || status.status === "downloading_model" || status.status === "downloading_runtime") {
    return "warning";
  }
  return "degraded";
}

function sidecarSummary(status: LocalSidecarStatusResponse): string {
  if (status.ready && status.status === "ready") return "Local Model sidecar is ready.";
  if (status.startupError) return status.startupError;
  if (!status.configured) return "Local Model is not configured (optional).";
  if (!status.modelDownloaded) return "Local Model is configured, but no model is downloaded.";
  if (!status.runtime.installed && !status.config.executablePath?.trim()) {
    return "Local Model needs a runtime before it can start.";
  }
  return `Local Model status: ${status.status.replace(/_/g, " ")}.`;
}

async function sidecarSection(): Promise<DiagnosticsSection> {
  try {
    const status = await localSidecarApi.status();
    return section("sidecar", "Local Model", [
      {
        id: "local-sidecar",
        label: "Managed Local Model",
        status: sidecarStatus(status),
        summary: sidecarSummary(status),
        details: status,
      },
    ]);
  } catch (error) {
    return section("sidecar", "Local Model", [
      {
        id: "local-sidecar",
        label: "Managed Local Model",
        status: "error",
        summary: errorMessage(error),
      },
    ]);
  }
}

async function sidecarLogTail(): Promise<DiagnosticsLogTail> {
  try {
    return await localSidecarApi.logTail(200);
  } catch (error) {
    return {
      available: false,
      path: null,
      lines: [],
      truncated: false,
      error: errorMessage(error),
    };
  }
}

function providerItem(connection: ConnectionSummary): DiagnosticItem {
  const id = connection.id?.trim() || "connection";
  return {
    id: `provider-${id}`,
    label: connection.name?.trim() || id,
    status: "unknown",
    summary: "Connection is configured. Run a probe to test provider reachability.",
    details: {
      connectionId: id,
      provider: connection.provider ?? "",
      model: connection.model ?? "",
      baseUrl: connection.baseUrl ?? "",
    },
  };
}

function invalidProviderItem(connection: ConnectionSummary, index: number): DiagnosticItem {
  return {
    id: `provider-invalid-${index}`,
    label: connection.name?.trim() || "Invalid provider entry",
    status: "error",
    summary: "Stored provider entry is missing an ID and cannot be probed.",
    details: {
      invalidReason: "missing-id",
      provider: connection.provider ?? "",
      model: connection.model ?? "",
      baseUrl: connection.baseUrl ?? "",
    },
  };
}

async function providersSection(): Promise<DiagnosticsSection> {
  try {
    const connections = await storageApi.list<ConnectionSummary>("connections", CONNECTION_SUMMARY_OPTIONS);
    const items = connections.map((connection, index) =>
      connection.id?.trim() ? providerItem(connection) : invalidProviderItem(connection, index),
    );
    if (items.length === 0) {
      items.push({
        id: "providers-empty",
        label: "Stored providers",
        status: "unknown",
        summary: "No stored model connections found. Add one when you want to use a remote model.",
      });
    }
    return section("providers", "Providers", items);
  } catch (error) {
    return section("providers", "Providers", [
      {
        id: "providers-list",
        label: "Stored providers",
        status: "error",
        summary: errorMessage(error),
      },
    ]);
  }
}

async function storageItem(entity: StorageEntity, label: string): Promise<DiagnosticItem> {
  try {
    await storageApi.list(entity, { fields: ["id"], limit: 1 });
    return {
      id: `storage-${entity}`,
      label,
      status: "ok",
      summary: "Readable through the active runtime.",
      details: { entity },
    };
  } catch (error) {
    return {
      id: `storage-${entity}`,
      label,
      status: "error",
      summary: errorMessage(error),
      details: { entity },
    };
  }
}

async function storageSection(): Promise<DiagnosticsSection> {
  const items = await Promise.all(STORAGE_CHECKS.map((check) => storageItem(check.entity, check.label)));
  items.push({
    id: "storage-imports",
    label: "Imports",
    status: "unknown",
    summary: "Import health is checked when import actions run; this dashboard does not scan import folders.",
  });
  return section("storage", "Storage", items);
}

async function sectionOrError(id: string, title: string, load: () => Promise<DiagnosticsSection>): Promise<DiagnosticsSection> {
  try {
    return await load();
  } catch (error) {
    const message = errorMessage(error);
    recordClientDiagnostic({
      level: "error",
      source: "health-diagnostics",
      message,
      details: { section: id, error },
    });
    return section(id, title, [
      {
        id: `${id}-refresh`,
        label: title,
        status: "error",
        summary: message,
      },
    ]);
  }
}

export async function createDiagnosticsSnapshot(remoteRuntimeUrl: string): Promise<DiagnosticsSnapshot> {
  const [runtime, sidecar, providers, storage, logTail] = await Promise.all([
    sectionOrError("runtime", "Runtime", () => runtimeSection(remoteRuntimeUrl)),
    sectionOrError("sidecar", "Local Model", sidecarSection),
    sectionOrError("providers", "Providers", providersSection),
    sectionOrError("storage", "Storage", storageSection),
    sidecarLogTail(),
  ]);
  const recentDiagnostics = getRecentClientDiagnostics();
  const generationTiming = buildGenerationTimingSection(recentDiagnostics);
  const sections = [runtime, sidecar, providers, storage, generationTiming];
  return {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    runtimeMode: runtimeMode(remoteRuntimeUrl),
    platform: getBrowserPlatformInfo(),
    logTail,
    overallStatus: diagnosticsOverallStatus(sections),
    sections,
    recentDiagnostics,
  };
}

export function useDiagnosticsSnapshot() {
  const remoteRuntimeUrl = useUIStore((state) => state.remoteRuntimeUrl);
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await createDiagnosticsSnapshot(remoteRuntimeUrl));
    } catch (refreshError) {
      const message = errorMessage(refreshError);
      recordClientDiagnostic({
        level: "error",
        source: "health-diagnostics",
        message,
        details: refreshError,
      });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [remoteRuntimeUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
