import { invokeTauri } from "./tauri-client";

export const regexScriptApi = {
  reorder: <T = unknown>(scriptIds: string[]) =>
    invokeTauri<T[]>("regex_script_reorder", {
      orderedIds: scriptIds,
    }),
};