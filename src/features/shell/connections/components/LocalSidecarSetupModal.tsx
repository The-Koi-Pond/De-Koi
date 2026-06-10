import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  HardDrive,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type {
  LocalSidecarConfigPatch,
  LocalSidecarCustomModelEntry,
  LocalSidecarQuantization,
  LocalSidecarRuntimePreference,
  LocalSidecarStatusResponse,
  LocalSidecarTestMessageResult,
} from "../../../../engine/contracts/types/sidecar";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { Modal } from "../../../../shared/components/ui/Modal";
import { cn } from "../../../../shared/lib/utils";

interface LocalSidecarSetupModalProps {
  open: boolean;
  onClose: () => void;
  status: LocalSidecarStatusResponse | null;
  onStatus: (status: LocalSidecarStatusResponse) => void;
  refreshStatus: () => Promise<LocalSidecarStatusResponse>;
}

type GpuLayersMode = "auto" | "cpu" | "custom";
type ConfigInputField =
  | "contextSize"
  | "maxTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "gpuLayers"
  | "executablePath"
  | "modelPath"
  | "model"
  | "customModelRepo";

const CONFIG_INPUT_FIELDS = new Set<ConfigInputField>([
  "contextSize",
  "maxTokens",
  "temperature",
  "topP",
  "topK",
  "gpuLayers",
  "executablePath",
  "modelPath",
  "model",
  "customModelRepo",
]);

function isConfigInputField(value: string): value is ConfigInputField {
  return CONFIG_INPUT_FIELDS.has(value as ConfigInputField);
}

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function parentModelPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function customModelOptionLabel(model: LocalSidecarCustomModelEntry, filenameCounts: Map<string, number>): string {
  const duplicateFilename = (filenameCounts.get(model.filename) ?? 0) > 1;
  const parentPath = parentModelPath(model.path);
  const disambiguator = parentPath || (model.path !== model.filename ? model.path : model.downloadUrl);
  const name = duplicateFilename && disambiguator ? `${model.filename} - ${disambiguator}` : model.filename;
  const size = model.sizeBytes ? ` (${formatBytes(model.sizeBytes)})` : "";
  return `${name}${size}`;
}

function formatSpeed(value: number | null | undefined): string {
  const formatted = formatBytes(value);
  return formatted ? `${formatted}/s` : "";
}

function progressPercent(downloaded: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}

function formatRuntimePreferenceLabel(preference: LocalSidecarRuntimePreference): string {
  switch (preference) {
    case "auto":
      return "Auto detect";
    case "nvidia":
      return "NVIDIA GPU (CUDA)";
    case "amd":
      return "AMD GPU";
    case "intel":
      return "Intel GPU";
    case "vulkan":
      return "Vulkan GPU";
    case "cpu":
      return "CPU only";
    case "system":
      return "System llama-server";
    default:
      return preference;
  }
}

function getRuntimePreferenceOptions(platform?: string, arch?: string): LocalSidecarRuntimePreference[] {
  if (platform === "win32" && arch === "x64") return ["auto", "nvidia", "amd", "intel", "vulkan", "cpu", "system"];
  if (platform === "linux" && arch === "x64") return ["auto", "nvidia", "amd", "intel", "vulkan", "cpu", "system"];
  if (platform === "linux" && arch === "arm64") return ["auto", "vulkan", "cpu", "system"];
  if (platform === "win32" && arch === "arm64") return ["auto", "cpu", "system"];
  if (platform === "darwin" && arch === "x64") return ["auto", "cpu", "system"];
  return ["auto", "cpu", "system"];
}

function describeGpuLayers(gpuLayers: number): string {
  if (gpuLayers === -1) return "Auto offload";
  if (gpuLayers === 0) return "CPU only";
  return `${gpuLayers} GPU layers`;
}

function compactTokens(value: number): string {
  if (value < 1000) return String(value);
  const compact = value / 1000;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
}

function runtimeVariantLabel(variant: string | null | undefined): string | null {
  return variant ? variant.replace(/-/g, " ") : null;
}

function gpuModeFromLayers(value: number): GpuLayersMode {
  if (value === -1) return "auto";
  if (value === 0) return "cpu";
  return "custom";
}

export function LocalSidecarSetupModal({
  open,
  onClose,
  status,
  onStatus,
  refreshStatus,
}: LocalSidecarSetupModalProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);
  const [customRepo, setCustomRepo] = useState("unsloth/gemma-4-E2B-it-GGUF");
  const [customModels, setCustomModels] = useState<LocalSidecarCustomModelEntry[]>([]);
  const [listedCustomRepo, setListedCustomRepo] = useState<string | null>(null);
  const [selectedCustomModel, setSelectedCustomModel] = useState("");
  // LEGACY_PARITY: local-sidecar-curated-presets - Full setup defaults to Q8 as the quality preset.
  const [selectedQuant, setSelectedQuant] = useState<LocalSidecarQuantization>("q8_0");
  const [testResult, setTestResult] = useState<LocalSidecarTestMessageResult | null>(null);
  const [contextSizeInput, setContextSizeInput] = useState("8192");
  const [maxTokensInput, setMaxTokensInput] = useState("4096");
  const [temperatureInput, setTemperatureInput] = useState("0.3");
  const [topPInput, setTopPInput] = useState("0.95");
  const [topKInput, setTopKInput] = useState("64");
  const [gpuLayersInput, setGpuLayersInput] = useState("");
  const [gpuLayersMode, setGpuLayersMode] = useState<GpuLayersMode>("auto");
  const [executablePathInput, setExecutablePathInput] = useState("");
  const [modelPathInput, setModelPathInput] = useState("");
  const [modelNameInput, setModelNameInput] = useState("local-sidecar");
  const openRefreshTokenRef = useRef(0);
  const fallbackConfigRef = useRef<LocalSidecarStatusResponse["config"] | null>(null);
  const dirtyFieldsRef = useRef<Set<ConfigInputField>>(new Set());
  const dirtyFieldVersionsRef = useRef<Map<ConfigInputField, number>>(new Map());

  const config = status?.config;
  const runtime = status?.runtime;
  const progress = status?.download;
  const isDownloading = progress?.status === "downloading";
  const isRuntimeDownloading = status?.status === "downloading_runtime";
  const hasModel = !!status?.modelDownloaded;
  const hasRuntime = !!runtime?.installed || !!config?.executablePath?.trim();
  const canRun = hasModel && hasRuntime && !isDownloading && !isRuntimeDownloading;
  const isReady = !!status?.ready;
  const progressValue = progressPercent(progress?.downloaded ?? 0, progress?.total ?? 0);
  const runtimeOptions = useMemo(
    () => getRuntimePreferenceOptions(status?.platform, status?.arch),
    [status?.platform, status?.arch],
  );
  const curatedModels = useMemo(() => status?.curatedModels ?? [], [status?.curatedModels]);
  const selectedPreset =
    curatedModels.find((model) => model.quantization === selectedQuant) ?? curatedModels[0] ?? null;
  const customModelFilenameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of customModels) {
      counts.set(model.filename, (counts.get(model.filename) ?? 0) + 1);
    }
    return counts;
  }, [customModels]);

  const markConfigInputDirty = useCallback((field: ConfigInputField) => {
    dirtyFieldsRef.current.add(field);
    dirtyFieldVersionsRef.current.set(field, (dirtyFieldVersionsRef.current.get(field) ?? 0) + 1);
  }, []);

  const hydrateConfigInputs = useCallback(
    (nextConfig: LocalSidecarStatusResponse["config"], options: { preserveDirty?: boolean } = {}) => {
      const shouldHydrate = (field: ConfigInputField) => !options.preserveDirty || !dirtyFieldsRef.current.has(field);
      if (shouldHydrate("contextSize")) setContextSizeInput(String(nextConfig.contextSize));
      if (shouldHydrate("maxTokens")) setMaxTokensInput(String(nextConfig.maxTokens));
      if (shouldHydrate("temperature")) setTemperatureInput(String(nextConfig.temperature));
      if (shouldHydrate("topP")) setTopPInput(String(nextConfig.topP));
      if (shouldHydrate("topK")) setTopKInput(String(nextConfig.topK));
      if (shouldHydrate("gpuLayers")) {
        setGpuLayersInput(nextConfig.gpuLayers > 0 ? String(nextConfig.gpuLayers) : "");
        setGpuLayersMode(gpuModeFromLayers(nextConfig.gpuLayers));
      }
      if (shouldHydrate("executablePath")) setExecutablePathInput(nextConfig.executablePath ?? "");
      if (shouldHydrate("modelPath")) setModelPathInput(nextConfig.modelPath ?? "");
      if (shouldHydrate("model")) setModelNameInput(nextConfig.model || "local-sidecar");
      if (shouldHydrate("customModelRepo")) {
        setCustomRepo(nextConfig.customModelRepo ?? "unsloth/gemma-4-E2B-it-GGUF");
      }
    },
    [],
  );

  useEffect(() => {
    fallbackConfigRef.current = config ?? null;
  }, [config]);

  const runtimeStatusLabel = isReady
    ? "Ready"
    : isRuntimeDownloading
      ? "Installing runtime"
      : status?.status === "server_error"
        ? "Setup error"
        : hasRuntime
          ? "Runtime available"
          : "Not installed";
  const runtimeSummary = config
    ? `${formatRuntimePreferenceLabel(config.runtimePreference)}, ${describeGpuLayers(
        config.gpuLayers,
      )}, ${compactTokens(config.contextSize)} ctx, ${compactTokens(config.maxTokens)} max`
    : "Loading runtime settings";

  useEffect(() => {
    if (!open) {
      openRefreshTokenRef.current += 1;
      dirtyFieldsRef.current.clear();
      dirtyFieldVersionsRef.current.clear();
      setCustomModels([]);
      setListedCustomRepo(null);
      setSelectedCustomModel("");
      setTestResult(null);
      return;
    }

    const token = openRefreshTokenRef.current + 1;
    openRefreshTokenRef.current = token;
    void refreshStatus()
      .then((next) => {
        if (openRefreshTokenRef.current !== token) return;
        hydrateConfigInputs(next.config, { preserveDirty: true });
      })
      .catch((error) => {
        if (openRefreshTokenRef.current !== token) return;
        toast.error(error instanceof Error ? error.message : "Failed to load Local AI Model status");
        if (fallbackConfigRef.current) {
          hydrateConfigInputs(fallbackConfigRef.current, { preserveDirty: true });
        }
      });
  }, [hydrateConfigInputs, open, refreshStatus]);

  useEffect(() => {
    if (!open || !status) return;
    const active = isDownloading || isRuntimeDownloading || status.status === "starting";
    if (!active) return;
    const timer = window.setInterval(() => {
      void refreshStatus().catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isDownloading, isRuntimeDownloading, open, refreshStatus, status]);

  useEffect(() => {
    if (status?.status === "server_error" || testResult) {
      setShowRuntimeSettings(true);
    }
  }, [status?.status, testResult]);

  useEffect(() => {
    if (customModels.length > 0 && !customModels.some((model) => model.path === selectedCustomModel)) {
      setSelectedCustomModel(customModels[0]!.path);
    }
  }, [customModels, selectedCustomModel]);

  useEffect(() => {
    if (!curatedModels.length || curatedModels.some((model) => model.quantization === selectedQuant)) return;
    setSelectedQuant(curatedModels[0]!.quantization);
  }, [curatedModels, selectedQuant]);

  const runStatusAction = async (
    label: string,
    action: () => Promise<LocalSidecarStatusResponse>,
    successMessage: string,
  ) => {
    setBusy(label);
    try {
      const next = await action();
      onStatus(next);
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Local AI Model action failed");
      await refreshStatus().catch(() => {});
      return false;
    } finally {
      setBusy(null);
    }
  };

  const savePatch = async (
    label: string,
    patch: LocalSidecarConfigPatch,
    successMessage = "Local AI settings saved",
  ) => {
    const patchFields = Object.keys(patch).filter(isConfigInputField);
    const startedVersions = new Map(
      patchFields.map((field) => [field, dirtyFieldVersionsRef.current.get(field) ?? 0] as const),
    );
    const saved = await runStatusAction(label, () => localSidecarApi.updateConfig(patch), successMessage);
    if (!saved) return;
    for (const field of patchFields) {
      if ((dirtyFieldVersionsRef.current.get(field) ?? 0) !== startedVersions.get(field)) continue;
      dirtyFieldsRef.current.delete(field);
    }
  };

  const handleRuntimePreferenceChange = (preference: LocalSidecarRuntimePreference) => {
    void savePatch("runtime-preference", { runtimePreference: preference }, "Runtime target saved");
  };

  const handleGpuModeChange = (mode: GpuLayersMode) => {
    markConfigInputDirty("gpuLayers");
    setGpuLayersMode(mode);
    if (mode === "auto") {
      void savePatch("gpu-layers", { gpuLayers: -1 }, "GPU offload saved");
      return;
    }
    if (mode === "cpu") {
      void savePatch("gpu-layers", { gpuLayers: 0 }, "GPU offload saved");
      return;
    }
    if (!gpuLayersInput) setGpuLayersInput("999");
  };

  const handleApplyCustomGpuLayers = () => {
    const parsed = Number.parseInt(gpuLayersInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1024) {
      toast.error("GPU layers must be between 1 and 1024");
      return;
    }
    void savePatch("gpu-layers", { gpuLayers: parsed }, "GPU offload saved");
  };

  const handleApplyGenerationSettings = () => {
    const parsedContextSize = Number.parseInt(contextSizeInput, 10);
    const parsedMaxTokens = Number.parseInt(maxTokensInput, 10);
    const parsedTemperature = Number.parseFloat(temperatureInput);
    const parsedTopP = Number.parseFloat(topPInput);
    const parsedTopK = Number.parseInt(topKInput, 10);

    if (
      !Number.isFinite(parsedContextSize) ||
      parsedContextSize < 512 ||
      parsedContextSize > 32768 ||
      !Number.isFinite(parsedMaxTokens) ||
      parsedMaxTokens < 64 ||
      parsedMaxTokens > 32768 ||
      !Number.isFinite(parsedTemperature) ||
      parsedTemperature < 0 ||
      parsedTemperature > 2 ||
      !Number.isFinite(parsedTopP) ||
      parsedTopP <= 0 ||
      parsedTopP > 1 ||
      !Number.isFinite(parsedTopK) ||
      parsedTopK < 0 ||
      parsedTopK > 500
    ) {
      toast.error("Check the inference setting ranges");
      return;
    }

    void savePatch("generation-settings", {
      contextSize: parsedContextSize,
      maxTokens: parsedMaxTokens,
      temperature: parsedTemperature,
      topP: parsedTopP,
      topK: parsedTopK,
    });
  };

  const handleApplyAdvancedPaths = () => {
    void savePatch("advanced-paths", {
      executablePath: executablePathInput || null,
      modelPath: modelPathInput || null,
      model: modelNameInput || "local-sidecar",
    });
  };

  const handleListCustomModels = async () => {
    const repo = customRepo.trim();
    if (!repo) {
      toast.error("Enter a HuggingFace repo first");
      return;
    }
    setBusy("list-custom");
    try {
      const result = await localSidecarApi.listHuggingFaceModels(repo);
      setCustomModels(result.models);
      setListedCustomRepo(repo);
      setSelectedCustomModel(result.models[0]?.path ?? "");
      toast.success(result.models.length ? "GGUF files loaded" : "No GGUF files found");
    } catch (error) {
      setCustomModels([]);
      setListedCustomRepo(null);
      setSelectedCustomModel("");
      toast.error(error instanceof Error ? error.message : "Failed to list GGUF files");
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadCustom = () => {
    const repo = customRepo.trim();
    if (!selectedCustomModel || !listedCustomRepo || repo !== listedCustomRepo) {
      toast.error("List GGUF files for this repo before downloading");
      return;
    }
    void runStatusAction(
      "download-custom",
      () => localSidecarApi.downloadCustom({ repo, modelPath: selectedCustomModel }),
      "Custom model download started",
    );
  };

  const handleCuratedDownload = () => {
    if (!selectedPreset) {
      toast.error("Choose a curated preset first");
      return;
    }
    void runStatusAction(
      `download-${selectedPreset.quantization}`,
      () => localSidecarApi.downloadCurated(selectedPreset.quantization),
      "Model download started",
    );
  };

  const handleTestMessage = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const result = await localSidecarApi.testMessage();
      setTestResult(result);
      toast.success("Local AI test message finished");
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Local AI test failed");
      await refreshStatus().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const generationDirty =
    !!config &&
    (contextSizeInput !== String(config.contextSize) ||
      maxTokensInput !== String(config.maxTokens) ||
      temperatureInput !== String(config.temperature) ||
      topPInput !== String(config.topP) ||
      topKInput !== String(config.topK));
  const pathsDirty =
    !!config &&
    (executablePathInput !== (config.executablePath ?? "") ||
      modelPathInput !== (config.modelPath ?? "") ||
      modelNameInput !== (config.model || "local-sidecar"));
  const customSelectionMatchesRepo =
    !!selectedCustomModel && !!listedCustomRepo && customRepo.trim() === listedCustomRepo;

  return (
    <Modal open={open} onClose={onClose} title="Local AI Model" width="max-w-2xl">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
            <BrainCircuit size="1.25rem" className="text-purple-400" />
          </div>
          <div className="text-sm text-[var(--muted-foreground)]">
            <p>
              De-Koi can run a local sidecar for trackers, scene analysis, and game-state helpers without spending
              main-model tokens.
            </p>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]/75">
              Set up the runtime first, then choose either a curated Gemma preset or any GGUF from HuggingFace. Runtime
              device selection lives inside Runtime Settings.
            </p>
          </div>
        </div>

        {hasModel && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                <Check size="1rem" className="text-emerald-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-emerald-300">
                  {status?.modelDisplayName ?? "Model installed"}
                </div>
                <div className="truncate text-xs text-[var(--muted-foreground)]/75">
                  {config?.customModelRepo
                    ? `Custom GGUF from ${config.customModelRepo}`
                    : `${config?.quantization?.toUpperCase() ?? "Curated"} Gemma GGUF preset`}
                  {status?.modelSize ? ` - ${formatBytes(status.modelSize)}` : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Server size="0.95rem" className="text-purple-300" />
                Runtime
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted-foreground)]">
                <span className="rounded-full border border-[var(--border)] bg-[var(--secondary)]/45 px-2 py-0.5 text-[var(--foreground)]">
                  {runtimeStatusLabel}
                </span>
                <span className="min-w-0 break-words">{runtimeSummary}</span>
              </div>
              <div className="mt-2 max-w-[58ch] break-words text-xs leading-relaxed text-[var(--muted-foreground)]/75">
                {runtime?.installed
                  ? runtime.source === "system"
                    ? `Using system llama-server${runtime.systemPath ? `: ${runtime.systemPath}` : ""}`
                    : runtime.variant
                      ? `Installed runtime: ${runtimeVariantLabel(runtime.variant)}`
                      : "Runtime installed and ready to use."
                  : config?.executablePath
                    ? `Using configured executable: ${config.executablePath}`
                    : "Install a managed runtime, choose System llama-server, or provide a custom executable path."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRuntimeSettings((current) => !current)}
              className="inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
            >
              <Settings2 size="0.875rem" />
              Runtime Settings
              {showRuntimeSettings ? <ChevronUp size="0.875rem" /> : <ChevronDown size="0.875rem" />}
            </button>
          </div>

          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            {!runtime?.installed && !config?.executablePath ? (
              <button
                type="button"
                onClick={() =>
                  void runStatusAction("runtime", () => localSidecarApi.installRuntime(), "Runtime install started")
                }
                disabled={!!busy || isDownloading || isRuntimeDownloading}
                className="inline-flex min-w-0 basis-44 items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "runtime" || isRuntimeDownloading ? (
                  <Loader2 size="0.875rem" className="animate-spin" />
                ) : (
                  <Download size="0.875rem" />
                )}
                Install Runtime
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() =>
                    void runStatusAction(
                      isReady ? "restart" : "start",
                      isReady ? localSidecarApi.restart : localSidecarApi.start,
                      isReady ? "Runtime restart requested" : "Runtime start requested",
                    )
                  }
                  disabled={!!busy || !canRun}
                  title={!hasModel ? "Download a model first" : !hasRuntime ? "Install a runtime first" : undefined}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "start" || busy === "restart" ? (
                    <Loader2 size="0.875rem" className="animate-spin" />
                  ) : isReady ? (
                    <RefreshCw size="0.875rem" />
                  ) : (
                    <Play size="0.875rem" />
                  )}
                  {isReady ? "Restart Runtime" : "Start Runtime"}
                </button>
                <button
                  type="button"
                  onClick={() => void runStatusAction("stop", localSidecarApi.stop, "Runtime stopped")}
                  disabled={!!busy || !isReady}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square size="0.875rem" />
                  Stop
                </button>
                {runtime?.installed && runtime.source !== "system" && (
                  <button
                    type="button"
                    onClick={() =>
                      void runStatusAction(
                        "reinstall-runtime",
                        () => localSidecarApi.installRuntime({ reinstall: true }),
                        "Runtime reinstall started",
                      )
                    }
                    disabled={!!busy || isDownloading || isRuntimeDownloading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size="0.875rem" />
                    Reinstall Runtime
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => void handleTestMessage()}
              disabled={!!busy || !canRun}
              title={!hasModel ? "Download a model first" : !hasRuntime ? "Install a runtime first" : undefined}
              className="inline-flex min-w-0 basis-44 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "test" ? (
                <Loader2 size="0.875rem" className="animate-spin" />
              ) : (
                <MessageSquare size="0.875rem" />
              )}
              Send Test Message
            </button>
          </div>

          {showRuntimeSettings && config && (
            <div className="mt-4 flex flex-col gap-4 rounded-xl border border-[var(--border)]/80 bg-[var(--secondary)]/35 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                    Runtime Target
                  </span>
                  <div className="relative">
                    <select
                      value={config.runtimePreference}
                      onChange={(event) =>
                        handleRuntimePreferenceChange(event.target.value as LocalSidecarRuntimePreference)
                      }
                      className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 pr-10 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-400/50 focus:ring-1 focus:ring-sky-400/20"
                    >
                      {runtimeOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatRuntimePreferenceLabel(option)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size="0.95rem"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]/70"
                    />
                  </div>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                    GPU Offload
                  </span>
                  <div className="relative">
                    <select
                      value={gpuLayersMode}
                      onChange={(event) => handleGpuModeChange(event.target.value as GpuLayersMode)}
                      className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 pr-10 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-400/50 focus:ring-1 focus:ring-sky-400/20"
                    >
                      <option value="auto">Auto offload</option>
                      <option value="cpu">CPU only</option>
                      <option value="custom">Custom GPU layers</option>
                    </select>
                    <ChevronDown
                      size="0.95rem"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]/70"
                    />
                  </div>
                  {gpuLayersMode === "custom" && (
                    <div className="flex gap-2">
                      <input
                        value={gpuLayersInput}
                        onChange={(event) => {
                          markConfigInputDirty("gpuLayers");
                          setGpuLayersInput(event.target.value.replace(/[^\d]/g, ""));
                        }}
                        inputMode="numeric"
                        placeholder="999"
                        className="w-24 rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-center text-sm text-[var(--foreground)] outline-none focus:border-sky-400/50"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCustomGpuLayers}
                        className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card)]"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </label>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/45 p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                  Inference Settings
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Context Window</span>
                    <input
                      value={contextSizeInput}
                      onChange={(event) => {
                        markConfigInputDirty("contextSize");
                        setContextSizeInput(event.target.value.replace(/[^\d]/g, ""));
                      }}
                      inputMode="numeric"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                      Max Response Tokens
                    </span>
                    <input
                      value={maxTokensInput}
                      onChange={(event) => {
                        markConfigInputDirty("maxTokens");
                        setMaxTokensInput(event.target.value.replace(/[^\d]/g, ""));
                      }}
                      inputMode="numeric"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Temperature</span>
                    <input
                      value={temperatureInput}
                      onChange={(event) => {
                        markConfigInputDirty("temperature");
                        setTemperatureInput(event.target.value.replace(/[^0-9.]/g, ""));
                      }}
                      inputMode="decimal"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Top P</span>
                    <input
                      value={topPInput}
                      onChange={(event) => {
                        markConfigInputDirty("topP");
                        setTopPInput(event.target.value.replace(/[^0-9.]/g, ""));
                      }}
                      inputMode="decimal"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 md:max-w-[12rem]">
                    <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Top K</span>
                    <input
                      value={topKInput}
                      onChange={(event) => {
                        markConfigInputDirty("topK");
                        setTopKInput(event.target.value.replace(/[^\d]/g, ""));
                      }}
                      inputMode="numeric"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleApplyGenerationSettings}
                    disabled={!generationDirty || busy === "generation-settings"}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "generation-settings" ? (
                      <Loader2 size="0.875rem" className="animate-spin" />
                    ) : (
                      <Save size="0.875rem" />
                    )}
                    Apply Settings
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/45 p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                  Advanced Paths
                </div>
                <div className="mt-3 grid gap-3">
                  <input
                    value={executablePathInput}
                    onChange={(event) => {
                      markConfigInputDirty("executablePath");
                      setExecutablePathInput(event.target.value);
                    }}
                    placeholder="Custom llama-server path, or leave blank for managed runtime"
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                  />
                  <input
                    value={modelPathInput}
                    onChange={(event) => {
                      markConfigInputDirty("modelPath");
                      setModelPathInput(event.target.value);
                    }}
                    placeholder="Custom GGUF model path, or use a managed download below"
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                  />
                  <input
                    value={modelNameInput}
                    onChange={(event) => {
                      markConfigInputDirty("model");
                      setModelNameInput(event.target.value);
                    }}
                    placeholder="OpenAI-compatible model id"
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleApplyAdvancedPaths}
                    disabled={!pathsDirty || busy === "advanced-paths"}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "advanced-paths" ? (
                      <Loader2 size="0.875rem" className="animate-spin" />
                    ) : (
                      <Save size="0.875rem" />
                    )}
                    Save Paths
                  </button>
                </div>
              </div>

              {runtime?.installed && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/45 p-3 text-xs text-[var(--muted-foreground)]/75">
                  <div>Status: {runtimeStatusLabel}</div>
                  {runtime.build && runtime.variant && (
                    <div>
                      Runtime build: {runtime.build} - {runtime.variant}
                    </div>
                  )}
                  {runtime.serverPath && <div className="break-all">Server: {runtime.serverPath}</div>}
                </div>
              )}
            </div>
          )}
        </section>

        {(isDownloading || isRuntimeDownloading || progress) && (
          <section className="rounded-xl border border-purple-400/25 bg-purple-500/5 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500/15">
                {isDownloading || isRuntimeDownloading ? (
                  <Loader2 size="1rem" className="animate-spin text-purple-300" />
                ) : (
                  <Check size="1rem" className="text-purple-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-purple-200">
                  {progress?.label ?? (isRuntimeDownloading ? "Installing local runtime" : "Preparing local model")}
                </div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)]/80">
                  {progress?.phase === "runtime"
                    ? "Downloading the local runtime for this device."
                    : progress?.phase === "model"
                      ? "Downloading the selected GGUF model."
                      : "Working on the local sidecar setup."}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>{progress?.status ?? status?.status}</span>
                <span>
                  {progress ? formatBytes(progress.downloaded) : ""}
                  {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className={cn(
                    "h-full rounded-full bg-purple-400 transition-all duration-300",
                    !progress?.total && "w-1/3",
                  )}
                  style={progress?.total ? { width: `${progressValue}%` } : undefined}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]/60">
                <span>{progress?.total ? `${progressValue}%` : ""}</span>
                <span>{formatSpeed(progress?.speed)}</span>
              </div>
              {isDownloading && (
                <button
                  type="button"
                  onClick={() =>
                    void runStatusAction(
                      "cancel",
                      async () => {
                        await localSidecarApi.cancelDownload();
                        return refreshStatus();
                      },
                      "Download cancelled",
                    )
                  }
                  disabled={!!busy}
                  className="mt-1 inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:opacity-50"
                >
                  <X size="0.75rem" />
                  Cancel
                </button>
              )}
              {progress?.error && <div className="text-xs text-red-300">{progress.error}</div>}
            </div>
          </section>
        )}

        {status?.startupError && (
          <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
            <div className="text-sm font-medium text-amber-200">Local runtime failed to start</div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]/85">{status.startupError}</div>
            {status.logPath && (
              <div className="mt-2 break-all text-xs text-[var(--muted-foreground)]/70">Log: {status.logPath}</div>
            )}
          </section>
        )}

        {testResult && (
          <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
            <div className="text-sm font-medium text-emerald-300">Local test message succeeded</div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]/75">
              {testResult.latencyMs}ms
              {testResult.nonce ? ` - token ${testResult.nonce}` : ""}
              {testResult.nonceVerified ? " - echoed by model" : ""}
            </div>
            <div className="mt-3 rounded-lg bg-[var(--secondary)] p-3 text-sm leading-relaxed text-[var(--foreground)]">
              {testResult.response}
            </div>
          </section>
        )}

        <section className="flex min-w-0 flex-col gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
            Curated Gemma 4 Presets
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            {curatedModels.map((model) => (
              <label
                key={model.quantization}
                className={cn(
                  "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                  selectedQuant === model.quantization
                    ? "border-purple-400/50 bg-purple-500/5"
                    : "border-[var(--border)] hover:bg-[var(--secondary)]/50",
                )}
              >
                <input
                  type="radio"
                  name="local-sidecar-quantization"
                  value={model.quantization}
                  checked={selectedQuant === model.quantization}
                  onChange={() => setSelectedQuant(model.quantization)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    selectedQuant === model.quantization ? "border-purple-400 bg-purple-400" : "border-[var(--border)]",
                  )}
                >
                  {selectedQuant === model.quantization && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-[var(--foreground)]">{model.label}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]/70">
                    <span className="inline-flex items-center gap-1">
                      <Download size="0.75rem" />
                      {formatBytes(model.sizeBytes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HardDrive size="0.75rem" />~{formatBytes(model.ramBytes)} RAM
                    </span>
                  </span>
                </span>
                {model.quantization === "q8_0" && (
                  <span className="shrink-0 rounded-full bg-purple-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-purple-300">
                    Recommended
                  </span>
                )}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleCuratedDownload}
            disabled={!selectedPreset || !!busy || isDownloading || isRuntimeDownloading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === `download-${selectedPreset?.quantization}` ? (
              <Loader2 size="0.875rem" className="animate-spin" />
            ) : (
              <Zap size="0.875rem" />
            )}
            {hasModel ? "Switch to Curated Preset" : "Use Curated Preset"}
          </button>
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <div>
            <div className="text-sm font-medium">Use Your Own Model From HuggingFace</div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]/75">
              Enter a GGUF repo on HuggingFace, list the available files, and choose the one you want to download.
            </div>
          </div>
          <div className="grid min-w-0 gap-2">
            <input
              value={customRepo}
              onChange={(event) => {
                markConfigInputDirty("customModelRepo");
                setCustomRepo(event.target.value);
                setCustomModels([]);
                setListedCustomRepo(null);
                setSelectedCustomModel("");
              }}
              placeholder="owner/repo"
              className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
            />
            <button
              type="button"
              onClick={() => void handleListCustomModels()}
              disabled={!!busy || isRuntimeDownloading || !customRepo.trim()}
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "list-custom" ? (
                <Loader2 size="0.875rem" className="animate-spin" />
              ) : (
                <Search size="0.875rem" />
              )}
              List Models
            </button>
          </div>
          {customModels.length > 0 && (
            <div className="grid min-w-0 gap-2">
              <select
                value={selectedCustomModel}
                onChange={(event) => setSelectedCustomModel(event.target.value)}
                className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
              >
                {customModels.map((model) => (
                  <option key={model.path} value={model.path}>
                    {customModelOptionLabel(model, customModelFilenameCounts)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleDownloadCustom}
                disabled={!!busy || isDownloading || isRuntimeDownloading || !customSelectionMatchesRepo}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-sky-400/15 px-4 py-2 text-sm font-medium text-sky-300 transition-colors hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "download-custom" ? (
                  <Loader2 size="0.875rem" className="animate-spin" />
                ) : (
                  <Download size="0.875rem" />
                )}
                {hasModel ? "Switch to Selected GGUF" : "Download Selected GGUF"}
              </button>
            </div>
          )}
        </section>

        {hasModel && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void runStatusAction("delete-model", localSidecarApi.deleteModel, "Local model removed")}
              disabled={!!busy || isDownloading || isRuntimeDownloading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size="0.875rem" />
              Delete Local Model
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
