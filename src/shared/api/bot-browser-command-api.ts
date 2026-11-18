import { invokeTauri } from "./tauri-client";

const BOT_BROWSER_PREFIX = "/bot-browser/";

/** Every Bot Browser path starts with `/bot-browser/`; a bare path like `chub/search?q=` gets it added. */
export function botBrowserPath(path: string): string {
  const trimmed = path.replace(/^\/+/, "");
  if (trimmed.startsWith("bot-browser/")) return `/${trimmed}`;
  return `${BOT_BROWSER_PREFIX}${trimmed}`;
}

/**
 * The two commands the Bot Browser talks to outside sites through. Rust (embedded or the hosted server) does the
 * fetching; these only name the path and carry the body.
 */
export const botBrowserCommandApi = {
  get: <T>(path: string) => invokeTauri<T>("bot_browser_get", { path: botBrowserPath(path) }),
  post: <T>(path: string, body?: unknown) =>
    invokeTauri<T>("bot_browser_post", { path: botBrowserPath(path), body: body ?? null }),
};
