import { invokeTauri } from "./tauri-client";

export const botBrowserCommandApi = {
  get: <T = unknown>(path: string) => invokeTauri<T>("bot_browser_get", { path }),
  post: <T = unknown>(path: string, body?: unknown) => invokeTauri<T>("bot_browser_post", { path, body: body ?? null }),
};
