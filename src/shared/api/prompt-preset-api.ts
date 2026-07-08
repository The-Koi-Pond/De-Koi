import type { PromptPreset } from "../../engine/contracts/types/prompt";
import { invokeTauri } from "./tauri-client";

export const promptPresetApi = {
  setDefault: (presetId: string) => invokeTauri<PromptPreset>("prompt_set_default", { presetId }),
};