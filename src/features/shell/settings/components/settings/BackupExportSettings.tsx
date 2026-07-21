import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "../../../../../shared/api/api-errors";
import {
  backupApi,
  profileApi,
  type ManagedBackup,
  type ProfileExportFormat,
} from "../../../../../shared/api/profile-api";
import {
  saveDownloadPayloadToUserSelectedLocation,
  saveTextFileToUserSelectedLocation,
} from "../../../../../shared/api/file-save-api";
import { readAdminSecretStorage } from "../../../../../shared/api/remote-runtime";
import { ExportFormatDialog, type ExportFormatChoice } from "../../../../../shared/components/ui/ExportFormatDialog";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { downloadBackupToBrowser } from "../../lib/backup-settings-actions";
import { buildBrowserStateExportPayload, type BrowserStateExportMode } from "../../lib/browser-state-export";

const PROFILE_EXPORT_SUCCESS_MESSAGES: Record<ProfileExportFormat, string> = {
  native: "Profile JSON exported!",
  compatible: "Compatible profile bundle exported!",
  zip: "Profile ZIP exported!",
};

function profileExportFallbackFormat(error: unknown) {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return null;
  const payload = error.details as { code?: unknown; details?: unknown };
  if (payload.code !== "PROFILE_EXPORT_JSON_TOO_LARGE") return null;
  const details =
    payload.details && typeof payload.details === "object" ? (payload.details as Record<string, unknown>) : {};
  return details.fallbackFormat === "zip" ? "zip" : null;
}

function readBrowserStorageEntries(storage: Storage) {
  const entries: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}

function remoteAdminAccessRequiredNow() {
  return useUIStore.getState().remoteRuntimeUrl.trim().length > 0 && readAdminSecretStorage().trim().length === 0;
}

export function BackupExportSettings() {
  const remoteRuntimeUrl = useUIStore((state) => state.remoteRuntimeUrl);
  const setSettingsTab = useUIStore((state) => state.setSettingsTab);
  const setPendingSettingsDestination = useUIStore((state) => state.setPendingSettingsDestination);
  const [exportingProfile, setExportingProfile] = useState(false);
  const [exportingLocalState, setExportingLocalState] = useState(false);
  const [exportProfileDialogOpen, setExportProfileDialogOpen] = useState(false);
  const [downloadingBackupName, setDownloadingBackupName] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const remoteAdminRequired = remoteAdminAccessRequiredNow();

  const allowPrivilegedBackupOperation = () => {
    if (!remoteAdminAccessRequiredNow()) return true;
    toast.error("Admin Access is required to manage backups on this remote runtime.");
    return false;
  };

  const backupsQuery = useQuery<ManagedBackup[]>({
    queryKey: ["backups"],
    queryFn: backupApi.listBackups,
    enabled: !remoteAdminRequired,
  });

  const createBackupMutation = useMutation({
    mutationFn: backupApi.createBackup,
    onSuccess: (result) => {
      toast.success(`Managed backup created: ${result.backupName}`);
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (error) => toast.error(toUserMessage(error, "createBackup")),
  });

  const deleteBackupMutation = useMutation({
    mutationFn: backupApi.deleteBackup,
    onSuccess: () => {
      toast.success("Managed backup deleted");
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (error) => toast.error(toUserMessage(error, "deleteBackup")),
  });

  const handleExportProfile = async (format: ProfileExportFormat) => {
    setExportingProfile(true);
    setExportProfileDialogOpen(false);
    try {
      const result = await saveDownloadPayloadToUserSelectedLocation(await profileApi.exportProfile(format), {
        title: "Export profile",
      });
      if (result !== "cancelled") toast.success(PROFILE_EXPORT_SUCCESS_MESSAGES[format]);
    } catch (error) {
      if (format === "native" && profileExportFallbackFormat(error) === "zip") {
        const confirmed = await showConfirmDialog({
          title: "Export profile as ZIP?",
          message: "This profile is too large for JSON export. Export it as a profile ZIP instead?",
          confirmLabel: "Export ZIP",
          cancelLabel: "Cancel",
        });
        if (confirmed) await handleExportProfile("zip");
        return;
      }
      toast.error(toUserMessage(error, "exportProfile"));
    } finally {
      setExportingProfile(false);
    }
  };

  const handleExportProfileChoice = (format: ExportFormatChoice) => {
    if (format !== "compatible-png") void handleExportProfile(format);
  };

  const handleExportLocalState = async (mode: BrowserStateExportMode) => {
    if (mode === "recovery") {
      const confirmed = await showConfirmDialog({
        title: "Export sensitive recovery state?",
        message:
          "This full-fidelity file can include your Remote Runtime username, password, and admin secret. Keep it private and do not share it for troubleshooting.",
        confirmLabel: "Export Sensitive File",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
    }

    setExportingLocalState(true);
    try {
      const exportedAt = new Date().toISOString();
      const payload = buildBrowserStateExportPayload({
        mode,
        exportedAt,
        origin: typeof window !== "undefined" ? window.location.origin : null,
        localStorage: readBrowserStorageEntries(window.localStorage),
        sessionStorage: readBrowserStorageEntries(window.sessionStorage),
      });
      const safeExport = mode === "safe";
      const result = await saveTextFileToUserSelectedLocation({
        filename: `${safeExport ? "de-koi-browser-support-state" : "de-koi-browser-local-state"}-${exportedAt.replace(/[:.]/g, "-")}.json`,
        content: JSON.stringify(payload, null, 2),
        title: safeExport ? "Export safe browser support state" : "Export sensitive browser recovery state",
        mimeType: "application/json",
        filters: [{ name: "JSON", extensions: ["json"], mimeType: "application/json" }],
      });
      if (result !== "cancelled") {
        toast.success(
          safeExport
            ? "Safe browser support state exported"
            : "Sensitive recovery file exported. Keep it private and do not share it.",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't export browser-local state");
    } finally {
      setExportingLocalState(false);
    }
  };

  const handleDownloadBackup = async (name?: string) => {
    if (!allowPrivilegedBackupOperation()) return;
    const key = name ?? "__current__";
    setDownloadingBackupName(key);
    try {
      const result = await downloadBackupToBrowser(name, {
        downloadBackup: backupApi.downloadBackup,
        saveDownloadPayload: (payload) =>
          saveDownloadPayloadToUserSelectedLocation(payload, {
            title: name ? "Download backup" : "Create backup",
          }),
      });
      if (result) toast.success(result.message);
    } catch (error) {
      toast.error(toUserMessage(error, "downloadBackup"));
    } finally {
      setDownloadingBackupName(null);
    }
  };

  const handleDeleteBackup = async (name: string) => {
    if (!allowPrivilegedBackupOperation()) return;
    const confirmed = await showConfirmDialog({
      title: "Delete managed backup?",
      message: `Delete ${name}? This backup cannot be recovered from De-Koi after deletion.`,
      confirmLabel: "Delete backup",
      cancelLabel: "Keep backup",
      tone: "destructive",
    });
    if (confirmed && allowPrivilegedBackupOperation()) deleteBackupMutation.mutate(name);
  };

  const handleCreateBackup = () => {
    if (allowPrivilegedBackupOperation()) createBackupMutation.mutate();
  };

  const openAdminAccess = () => {
    setSettingsTab("advanced");
    setPendingSettingsDestination("admin-access");
  };

  return (
    <section
      id="settings-destination-backups"
      className="scroll-mt-4 space-y-3 rounded-xl bg-[var(--secondary)]/40 p-3 ring-1 ring-[var(--border)] transition-shadow duration-700"
    >
      <ExportFormatDialog
        open={exportProfileDialogOpen}
        title="Export Profile"
        description="Native JSON keeps the v1 format for compatibility. Profile ZIP uses the versioned v2 package with chunked records and managed assets for large profiles and recovery."
        nativeDescription="Creates a De-Koi profile JSON for direct re-import when the profile is small enough."
        compatibleDescription="Exports character cards, simple persona JSON, and folderless lorebooks for other roleplay tools."
        zipDescription="Creates a v2 profile package with a manifest, chunked record files, integrity checks, and managed assets."
        showZipOption
        onClose={() => setExportProfileDialogOpen(false)}
        onSelect={handleExportProfileChoice}
      />

      <div>
        <div className="flex items-center gap-1.5">
          <Upload size="0.75rem" className="text-[var(--muted-foreground)]" />
          <h3 className="text-xs font-semibold">Backups & exports</h3>
          <HelpTooltip text="Creates, lists, downloads, and deletes managed full backups. Backups include data collections plus managed asset folders for recovery." />
        </div>
        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
          Download recovery copies and profile exports before removing data.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleCreateBackup}
          disabled={remoteAdminRequired || createBackupMutation.isPending}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {createBackupMutation.isPending ? (
            <Loader2 size="0.8125rem" className="animate-spin" />
          ) : (
            <Save size="0.8125rem" />
          )}
          Create Managed Backup
        </button>
        <button
          type="button"
          onClick={() => void handleDownloadBackup()}
          disabled={remoteAdminRequired || downloadingBackupName === "__current__"}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] transition-all hover:bg-[var(--secondary)]/80 active:scale-95 disabled:opacity-50"
        >
          {downloadingBackupName === "__current__" ? (
            <Loader2 size="0.8125rem" className="animate-spin" />
          ) : (
            <Download size="0.8125rem" />
          )}
          Download Backup
        </button>
      </div>

      {remoteAdminRequired && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg bg-amber-500/10 px-3 py-2 ring-1 ring-amber-500/25 max-sm:items-start max-sm:flex-col"
        >
          <div className="flex items-start gap-2 text-[0.6875rem] text-[var(--foreground)]">
            <AlertTriangle size="0.8125rem" className="mt-0.5 shrink-0 text-amber-500" />
            <span>Admin Access is required to manage backups on this remote runtime.</span>
          </div>
          <button
            type="button"
            onClick={openAdminAccess}
            className="shrink-0 rounded-md bg-[var(--background)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
          >
            Open Admin Access
          </button>
        </div>
      )}

      {!remoteAdminRequired && backupsQuery.isPending && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]"
        >
          <Loader2 size="0.8125rem" className="animate-spin" />
          <span>Loading existing backups...</span>
        </div>
      )}

      {!remoteAdminRequired && backupsQuery.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg bg-rose-500/10 px-3 py-2 ring-1 ring-rose-500/25 max-sm:items-start max-sm:flex-col"
        >
          <div className="flex items-start gap-2 text-[0.6875rem] text-[var(--foreground)]">
            <AlertTriangle size="0.8125rem" className="mt-0.5 shrink-0 text-rose-500" />
            <span>
              Couldn't load managed backups.{" "}
              {remoteRuntimeUrl.trim() ? "Check the remote runtime and Admin Access" : "Check app storage"}, then try
              again.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void backupsQuery.refetch()}
            disabled={backupsQuery.isFetching}
            className="shrink-0 rounded-md bg-[var(--background)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {!remoteAdminRequired && backupsQuery.isSuccess && backupsQuery.data.length === 0 && (
        <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
          No managed backups yet.
        </div>
      )}

      {!remoteAdminRequired && backupsQuery.isSuccess && backupsQuery.data.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Existing backups</span>
          {backupsQuery.data.map((backup) => (
            <div
              key={backup.name}
              className="flex items-center justify-between gap-2 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 ring-1 ring-[var(--border)]"
            >
              <div className="min-w-0">
                <span className="block truncate text-[0.6875rem] font-medium">{backup.name}</span>
                <span className="block text-[0.5625rem] text-[var(--muted-foreground)]">
                  {new Date(backup.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Download ${backup.name}`}
                  onClick={() => void handleDownloadBackup(backup.name)}
                  disabled={downloadingBackupName === backup.name}
                  className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  {downloadingBackupName === backup.name ? (
                    <Loader2 size="0.75rem" className="animate-spin" />
                  ) : (
                    <Download size="0.75rem" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${backup.name}`}
                  onClick={() => void handleDeleteBackup(backup.name)}
                  disabled={deleteBackupMutation.isPending}
                  className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-50"
                >
                  <Trash2 size="0.75rem" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="retro-divider" />
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setExportProfileDialogOpen(true)}
          disabled={exportingProfile}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {exportingProfile ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Upload size="0.8125rem" />}
          Export Profile
        </button>
        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          Safe support state removes stored credentials. Sensitive recovery state keeps everything and should never be
          shared.
        </p>
        <button
          type="button"
          onClick={() => void handleExportLocalState("safe")}
          disabled={exportingLocalState}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-all hover:bg-[var(--accent)] active:scale-95 disabled:opacity-50"
        >
          {exportingLocalState ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Upload size="0.8125rem" />}
          Export Safe Support State
        </button>
        <button
          type="button"
          onClick={() => void handleExportLocalState("recovery")}
          disabled={exportingLocalState}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 px-3 py-2 text-xs font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/10 active:scale-95 disabled:opacity-50"
        >
          {exportingLocalState ? (
            <Loader2 size="0.8125rem" className="animate-spin" />
          ) : (
            <AlertTriangle size="0.8125rem" />
          )}
          Export Sensitive Recovery State
        </button>
      </div>
    </section>
  );
}
