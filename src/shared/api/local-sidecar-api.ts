import type {
  LocalSidecarCustomModelEntry,
  LocalSidecarConfigPatch,
  LocalSidecarQuantization,
  LocalSidecarStatusResponse,
  LocalSidecarTestMessageResult,
} from "../../engine/contracts/types/sidecar";
import { invokeTauri } from "./tauri-client";

export const localSidecarApi = {
  status: () => invokeTauri<LocalSidecarStatusResponse>("local_sidecar_status"),
  updateConfig: (body: LocalSidecarConfigPatch) =>
    invokeTauri<LocalSidecarStatusResponse>("local_sidecar_update_config", { body }),
  installRuntime: (body: { reinstall?: boolean } = {}) =>
    invokeTauri<LocalSidecarStatusResponse>("local_sidecar_runtime_install", { body }),
  downloadCurated: (quantization: LocalSidecarQuantization) =>
    invokeTauri<LocalSidecarStatusResponse>("local_sidecar_download_curated", { body: { quantization } }),
  listHuggingFaceModels: (repo: string) =>
    invokeTauri<{ models: LocalSidecarCustomModelEntry[] }>("local_sidecar_list_huggingface_models", {
      body: { repo },
    }),
  downloadCustom: (body: { repo: string; modelPath: string }) =>
    invokeTauri<LocalSidecarStatusResponse>("local_sidecar_download_custom", { body }),
  cancelDownload: () => invokeTauri<{ ok: boolean }>("local_sidecar_download_cancel"),
  deleteModel: () => invokeTauri<LocalSidecarStatusResponse>("local_sidecar_delete_model"),
  start: () => invokeTauri<LocalSidecarStatusResponse>("local_sidecar_start"),
  stop: () => invokeTauri<LocalSidecarStatusResponse>("local_sidecar_stop"),
  restart: () => invokeTauri<LocalSidecarStatusResponse>("local_sidecar_restart"),
  testMessage: () => invokeTauri<LocalSidecarTestMessageResult>("local_sidecar_test_message"),
};
