import type { ChatPreset } from "../../engine/contracts/types/chat-preset";
import { invokeTauri } from "./tauri-client";

export const chatPresetApi = {
  setActive: (presetId: string) => invokeTauri<ChatPreset>("chat_preset_set_active", { presetId }),
};
