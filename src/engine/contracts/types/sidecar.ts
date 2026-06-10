export const LOCAL_SIDECAR_CONNECTION_ID = "sidecar:local";
export const LOCAL_SIDECAR_MODEL = "local-sidecar";

export type LocalSidecarStatus =
  | "not_configured"
  | "downloading_runtime"
  | "downloading_model"
  | "downloaded"
  | "stopped"
  | "starting"
  | "ready"
  | "server_error";

export type LocalSidecarQuantization = "q8_0" | "q4_k_m";
export type LocalSidecarRuntimePreference = "auto" | "nvidia" | "amd" | "intel" | "vulkan" | "cpu" | "system";

export interface LocalSidecarDownloadProgress {
  phase: "runtime" | "model";
  status: "downloading" | "complete" | "error";
  downloaded: number;
  total: number;
  speed: number;
  label: string | null;
  error: string | null;
}

export interface LocalSidecarRuntimeInfo {
  installed: boolean;
  build: string | null;
  variant: string | null;
  backend: "llama_cpp" | null;
  source: "bundled" | "system" | null;
  systemPath: string | null;
  serverPath: string | null;
}

export interface LocalSidecarModelInfo {
  quantization: LocalSidecarQuantization;
  backend: "llama_cpp";
  label: string;
  filename: string;
  sizeBytes: number;
  ramBytes: number;
  downloadUrl: string;
}

export interface LocalSidecarCustomModelEntry {
  path: string;
  filename: string;
  sizeBytes: number | null;
  quantizationLabel: string | null;
  downloadUrl: string;
}

export interface LocalSidecarConfig {
  enabled: boolean;
  executablePath: string | null;
  modelPath: string | null;
  model: string;
  contextSize: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  gpuLayers: number;
  quantization: LocalSidecarQuantization | null;
  customModelRepo: string | null;
  runtimePreference: LocalSidecarRuntimePreference;
}

export interface LocalSidecarStatusResponse {
  id: typeof LOCAL_SIDECAR_CONNECTION_ID;
  status: LocalSidecarStatus;
  configured: boolean;
  enabled: boolean;
  config: LocalSidecarConfig;
  ready: boolean;
  baseUrl: string | null;
  logPath: string | null;
  startupError: string | null;
  modelDownloaded: boolean;
  modelDisplayName: string | null;
  modelSize: number | null;
  runtime: LocalSidecarRuntimeInfo;
  platform: string;
  arch: string;
  curatedModels: LocalSidecarModelInfo[];
  download: LocalSidecarDownloadProgress | null;
}

export interface LocalSidecarConfigPatch {
  enabled?: boolean;
  executablePath?: string | null;
  modelPath?: string | null;
  model?: string;
  contextSize?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  gpuLayers?: number;
  runtimePreference?: LocalSidecarRuntimePreference;
}

export interface LocalSidecarTestMessageResult {
  success: boolean;
  response: string;
  nonce: string;
  nonceVerified: boolean;
  latencyMs: number;
  usage?: unknown;
}
