import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ApiError } from "../../../../shared/api/api-errors";
import { importApi } from "../../../../shared/api/import-api";
import { remoteRuntimeTarget } from "../../../../shared/api/remote-runtime";
import { runCardCheck } from "../../../catalog/characters/index";
import { applySTBulkImportInvalidations } from "../lib/st-bulk-import-invalidations";
import {
  buildInitialSTBulkSelection,
  createEmptySTBulkSelection,
  type STBulkCardCheck,
  type STBulkCategoryKey,
  type STBulkImportPhase,
  type STBulkImportProgress,
  type STBulkImportResult,
  type STBulkScanResult,
  type STBulkSelectionState,
  type STBulkTagImportMode,
} from "../lib/st-bulk-import-model";

interface DirectoryListResult {
  success: boolean;
  path?: string;
  folderToken?: string;
  folders?: string[];
  error?: string;
}

function describeImportError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return `${fallback}: ${error.message}`;
  }
  return error instanceof Error ? `${fallback}: ${error.message}` : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeImportResult(value: unknown): STBulkImportResult | null {
  const record = asRecord(value);
  if (!record) return null;
  const imported = asRecord(record.imported);
  if (!imported) return null;
  return {
    success: record.success !== false,
    error: typeof record.error === "string" ? record.error : undefined,
    imported: {
      characters: Number(imported.characters ?? 0),
      chats: Number(imported.chats ?? 0),
      groupChats: Number(imported.groupChats ?? 0),
      presets: Number(imported.presets ?? 0),
      lorebooks: Number(imported.lorebooks ?? 0),
      backgrounds: Number(imported.backgrounds ?? 0),
      personas: Number(imported.personas ?? 0),
    },
    characterIds: Array.isArray(record.characterIds)
      ? record.characterIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
    errors: Array.isArray(record.errors) ? record.errors.map(String) : [],
  };
}

function normalizeImportProgress(value: unknown): STBulkImportProgress | null {
  const record = asRecord(value);
  const result = normalizeImportResult({ success: true, imported: record?.imported ?? {} });
  if (!record || !result) return null;
  return {
    category: typeof record.category === "string" ? record.category : "Importing",
    item: typeof record.item === "string" ? record.item : "",
    current: Number(record.current ?? 0),
    total: Number(record.total ?? 0),
    imported: result.imported,
  };
}

export function useSTBulkImportController() {
  const queryClient = useQueryClient();
  const [folderPath, setFolderPathState] = useState("");
  const [folderToken, setFolderToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<STBulkImportPhase>("input");
  const [scanResult, setScanResult] = useState<STBulkScanResult | null>(null);
  const [selection, setSelection] = useState<STBulkSelectionState>(createEmptySTBulkSelection);
  const [importResult, setImportResult] = useState<STBulkImportResult | null>(null);
  const [cardCheck, setCardCheck] = useState<STBulkCardCheck | null>(null);
  // Bumped on reset and each import, so a slow check can't land on a newer import.
  const cardCheckRun = useRef(0);
  const [progress, setProgress] = useState<STBulkImportProgress | null>(null);
  const [error, setError] = useState("");
  const [characterTagImportMode, setCharacterTagImportMode] = useState<STBulkTagImportMode>("all");
  const [picking, setPicking] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [browserFolders, setBrowserFolders] = useState<string[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);

  const setFolderPath = useCallback((nextFolderPath: string) => {
    setFolderPathState(nextFolderPath);
    setFolderToken(null);
  }, []);

  const reset = useCallback(() => {
    setPhase("input");
    setScanResult(null);
    setFolderToken(null);
    setSelection(createEmptySTBulkSelection());
    setImportResult(null);
    setCardCheck(null);
    cardCheckRun.current += 1;
    setProgress(null);
    setError("");
    setCharacterTagImportMode("all");
  }, []);

  const checkImportedCards = useCallback((characterIds: string[]) => {
    const run = ++cardCheckRun.current;
    if (characterIds.length === 0) {
      setCardCheck(null);
      return;
    }
    setCardCheck({ status: "checking" });
    runCardCheck(characterIds).then(
      ({ checked, flagged }) => {
        if (run !== cardCheckRun.current) return;
        setCardCheck({ status: "done", checked, flagged: flagged.length });
      },
      (checkError: unknown) => {
        if (run !== cardCheckRun.current) return;
        setCardCheck({
          status: "failed",
          error: checkError instanceof Error ? checkError.message : String(checkError),
        });
      },
    );
  }, []);

  const scan = useCallback(async () => {
    if (!folderPath.trim()) return;
    setPhase("scanning");
    setError("");

    try {
      const data = await importApi.stBulkScan<STBulkScanResult>({ folderPath: folderPath.trim(), folderToken });
      if (data?.success) {
        setScanResult(data);
        setSelection(buildInitialSTBulkSelection(data));
        setPhase("preview");
      } else {
        setError(`Scan failed${data?.error ? `: ${data.error}` : ""}`);
        setPhase("input");
      }
    } catch (err) {
      setError(describeImportError(err, "Scan failed"));
      setPhase("input");
    }
  }, [folderPath, folderToken]);

  const loadDirectory = useCallback(async (dirPath?: string) => {
    setBrowserLoading(true);
    try {
      const data = await importApi.listDirectory<DirectoryListResult>(dirPath || "");
      if (!data?.success || !data.path) {
        setBrowserFolders([]);
        setFolderToken(null);
        setError(`Unable to list directories${data?.error ? `: ${data.error}` : ""}`);
        return;
      }
      setBrowserPath(data.path);
      setFolderToken(data.folderToken ?? null);
      setBrowserFolders(data.folders ?? []);
    } catch (err) {
      setBrowserFolders([]);
      setFolderToken(null);
      setError(describeImportError(err, "Unable to list directories"));
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  const browse = useCallback(async () => {
    setPicking(true);
    setError("");
    let remoteConfigured = false;
    try {
      remoteConfigured = Boolean(remoteRuntimeTarget());
    } catch (err) {
      setError(describeImportError(err, "Unable to open remote folder browser"));
      setPicking(false);
      return;
    }
    if (remoteConfigured) {
      setShowFolderBrowser(true);
      await loadDirectory(folderPath || undefined);
      setPicking(false);
      return;
    }
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected.trim()) {
        const data = await importApi.listDirectory<DirectoryListResult>(selected, { pickerSelected: true });
        if (!data?.success || !data.path) {
          setError(`Unable to list directories${data?.error ? `: ${data.error}` : ""}`);
          setShowFolderBrowser(true);
          setPicking(false);
          void loadDirectory(folderPath || undefined);
          return;
        }
        setFolderPathState(data.path);
        setFolderToken(data.folderToken ?? null);
        setBrowserPath(data.path);
        setBrowserFolders(data.folders ?? []);
        setPicking(false);
        return;
      }
    } catch (err) {
      setError(describeImportError(err, "Unable to open folder picker"));
    }
    setPicking(false);
    setShowFolderBrowser(true);
    void loadDirectory(folderPath || undefined);
  }, [folderPath, loadDirectory]);

  const selectBrowserFolder = useCallback(() => {
    setFolderPathState(browserPath);
    setShowFolderBrowser(false);
  }, [browserPath]);

  const updateCategorySelection = useCallback((category: STBulkCategoryKey, nextIds: string[]) => {
    setSelection((prev) => ({ ...prev, [category]: nextIds }));
  }, []);

  const toggleCategoryItem = useCallback((category: STBulkCategoryKey, itemId: string, checked: boolean) => {
    setSelection((prev) => {
      const existing = new Set(prev[category]);
      if (checked) existing.add(itemId);
      else existing.delete(itemId);
      return { ...prev, [category]: [...existing] };
    });
  }, []);

  const importSelected = useCallback(async () => {
    if (!folderPath.trim()) return;
    setPhase("importing");
    setProgress(null);
    setError("");

    try {
      const payload = {
        folderPath: folderPath.trim(),
        folderToken,
        options: { ...selection, characterTagImportMode },
      };
      let data: STBulkImportResult | null = null;
      for await (const event of importApi.stBulkRunEvents(payload)) {
        if (event.type === "progress") {
          const nextProgress = normalizeImportProgress(event.data);
          if (nextProgress) setProgress(nextProgress);
          continue;
        }
        if (event.type === "done") {
          data = normalizeImportResult(event.data);
          continue;
        }
        if (event.type === "error") {
          const errorData = asRecord(event.data);
          throw new Error(typeof errorData?.error === "string" ? errorData.error : "Import failed");
        }
      }
      data ??= normalizeImportResult(await importApi.stBulkRun<unknown>(payload));
      if (!data) throw new Error("The import sent back no result");
      if (data.success) {
        setImportResult(data);
        setPhase("done");
        applySTBulkImportInvalidations(queryClient, data.imported);
        checkImportedCards(data.characterIds);
      } else {
        setError(`Import failed${data.error ? `: ${data.error}` : ""}`);
        setPhase("preview");
      }
    } catch (err) {
      setError(describeImportError(err, "Import failed"));
      setPhase("preview");
    }
  }, [characterTagImportMode, checkImportedCards, folderPath, folderToken, queryClient, selection]);

  return {
    folderPath,
    phase,
    scanResult,
    selection,
    importResult,
    cardCheck,
    progress,
    error,
    characterTagImportMode,
    picking,
    showFolderBrowser,
    browserPath,
    browserFolders,
    browserLoading,
    builtinPresetCount: scanResult?.presets.filter((item) => item.isBuiltin).length ?? 0,
    selectedCount: Object.values(selection).reduce((sum, ids) => sum + ids.length, 0),
    hasAnySelected: Object.values(selection).some((ids) => ids.length > 0),
    setFolderPath,
    setCharacterTagImportMode,
    reset,
    scan,
    browse,
    loadDirectory,
    selectBrowserFolder,
    updateCategorySelection,
    toggleCategoryItem,
    importSelected,
  };
}
