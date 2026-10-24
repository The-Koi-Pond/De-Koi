import { invokeTauri } from "./tauri-client";
import { invalidateRemoteManagedAssetObjectUrlsAfter } from "./local-file-api";

/** How a started OpenRouter login finishes: the browser comes back on its own, or the user pastes a code. */
export type OpenRouterLoginMode = "callback" | "code";

export type OpenRouterLoginStart = {
  loginId: string;
  authUrl: string;
  mode: OpenRouterLoginMode;
  expiresInMs: number;
};

export type OpenRouterLoginStatus =
  | { status: "waiting"; connectionId: string }
  | { status: "done"; connectionId: string }
  | { status: "failed"; connectionId?: string; message: string };

export const connectionCommandApi = {
  test: <T = unknown>(id: string) => invokeTauri<T>("connection_test", { id }),
  testMessage: <T = unknown>(id: string) => invokeTauri<T>("connection_test_message", { id }),
  testImage: <T = unknown>(id: string) => invokeTauri<T>("connection_test_image", { id }),
  diagnoseClaudeSubscription: <T = unknown>(id: string) =>
    invokeTauri<T>("connection_diagnose_claude_subscription", { id }),
  models: <T = unknown>(id: string) => invokeTauri<T>("connection_models", { id }),
  saveDefaultParameters: (id: string, params: Record<string, unknown> | null) =>
    invokeTauri("connection_save_default_parameters", { id, params }),
  uploadImage: <T = unknown>(id: string, image: string, filename?: string) =>
    invalidateRemoteManagedAssetObjectUrlsAfter(
      invokeTauri<T>("connection_image_upload", { id, body: { image, filename } }),
      "entity-image",
    ),
  /** Starts "Log in with OpenRouter" for an OpenRouter connection. The key is saved server-side, never returned. */
  openRouterLoginStart: (id: string) => invokeTauri<OpenRouterLoginStart>("connection_openrouter_login_start", { id }),
  openRouterLoginStatus: (loginId: string) =>
    invokeTauri<OpenRouterLoginStatus>("connection_openrouter_login_status", { loginId }),
  /** Finishes a paste-a-code login with the code OpenRouter showed the user. */
  openRouterLoginFinish: (loginId: string, code: string) =>
    invokeTauri<{ status: "done"; connectionId: string }>("connection_openrouter_login_finish", { loginId, code }),
  reorderFolders: <T = unknown>(orderedIds: string[]) => invokeTauri<T>("connection_folder_reorder", { orderedIds }),
  move: <T = unknown>(connectionId: string, folderId: string | null) =>
    invokeTauri<T>("connection_move", { connectionId, folderId }),
};
