import { useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "../../../../engine/contracts/constants/defaults";
import type { StorageEntity } from "../../../../engine/capabilities/storage";
import type { LocalSidecarStatusResponse } from "../../../../engine/contracts/types/sidecar";
import { checkRemoteRuntimeHealth, hasEmbeddedTauriRuntime } from "../../../../shared/api/remote-runtime";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { getRecentClientDiagnostics, recordClientDiagnostic } from "../../../../shared/lib/client-diagnostics";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  diagnosticsOverallStatus,
  type DiagnosticItem,
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
  if (status.ready && status.status === "ready") return "ok";
  if (status.status === "server_error") return "error";
  if (status.status === "starting" || status.status === "downloading_model" || status.status === "downloading_runtime") {
    return "warning";
  }
  return status.configured ? "degraded" : "warning";
}

function sidecarSummary(status: LocalSidecarStatusResponse): string {
  if (status.ready && status.status === "ready") return "Local Model sidecar is ready.";
  if (status.startupError) return status.startupError;
  if (!status.configured) return "Local Model is not configured yet.";
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

function providerItem(connection: ConnectionSummary): DiagnosticItem {
  const id = connection.id?.trim() || "connection";
  return {
    id: `provider-${id}`,
    label: connection.name?.trim() || id,
    status: "warning",
    summary: "Connection is configured. Run an explicit probe to test provider reachability.",
    details: {
      connectionId: id,
      provider: connection.provider ?? "",
      model: connection.model ?? "",
      baseUrl: connection.baseUrl ?? "",
    },
  };
}

async function providersSection(): Promise<DiagnosticsSection> {
  try {
    const connections = await storageApi.list<ConnectionSummary>("connections", CONNECTION_SUMMARY_OPTIONS);
    const items = connections
      .filter((connection) => !!connection.id?.trim())
      .map(providerItem);
    if (items.length === 0) {
      items.push({
        id: "providers-empty",
        label: "Stored providers",
        status: "warning",
        summary: "No stored model connections found.",
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

export function useDiagnosticsSnapshot() {
  const remoteRuntimeUrl = useUIStore((state) => state.remoteRuntimeUrl);
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runtime, sidecar, providers, storage] = await Promise.all([
        runtimeSection(remoteRuntimeUrl),
        sidecarSection(),
        providersSection(),
        storageSection(),
      ]);
      const sections = [runtime, sidecar, providers, storage];
      const next: DiagnosticsSnapshot = {
        generatedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        runtimeMode: runtimeMode(remoteRuntimeUrl),
        overallStatus: diagnosticsOverallStatus(sections),
        sections,
        recentDiagnostics: getRecentClientDiagnostics(),
      };
      setSnapshot(next);
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
