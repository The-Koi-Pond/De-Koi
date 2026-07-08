import type { ChatFolder, ChatMode } from "../../engine/contracts/types/chat";
import { invokeTauri } from "./tauri-client";

export const chatFolderApi = {
  reorder: (input: { mode: ChatMode; folderIds: string[] }) =>
    invokeTauri<ChatFolder[]>("chat_folder_reorder", {
      mode: input.mode,
      orderedIds: input.folderIds,
    }),
};
