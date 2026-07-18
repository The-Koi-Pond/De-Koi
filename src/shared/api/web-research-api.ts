import { invokeTauri } from "./tauri-client";

export const webResearchApi = {
  search: <T = unknown>(body: { chatId: string; grantId: string; query: string; maxResults?: number }) =>
    invokeTauri<T>("character_web_search", { body }),
  readPage: <T = unknown>(body: { chatId: string; grantId: string; query: string; url: string }) =>
    invokeTauri<T>("character_web_read_page", { body }),
};
