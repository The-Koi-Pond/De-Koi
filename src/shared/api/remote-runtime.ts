import type { LlmChunk, LlmRequest } from "../../engine/capabilities/llm";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../engine/contracts/types/sidecar";
import { useUIStore } from "../stores/ui.store";
import { ApiError, parseRetryAfterMs } from "./api-errors";
import { ignoreLlmStreamCancelFailure } from "./llm-cancel-logging";

const REMOTE_COMMANDS = new Set([
  "load_url_binary",
  "profile_import",
  "backup_create",
  "backup_list",
  "backup_delete",
  "backup_download",
  "prompt_export",
  "prompts_export_bulk",
  "character_export",
  "character_export_png",
  "character_embedded_lorebook_import",
  "characters_export_bulk",
  "persona_export",
  "personas_export_bulk",
  "lorebook_export",
  "lorebooks_export_bulk",
  "lorebook_vectorize",
  "backgrounds_list",
  "backgrounds_tags",
  "background_upload",
  "background_delete",
  "background_tags_update",
  "background_rename",
  "fonts_list",
  "fonts_google_download",
  "fonts_upload",
  "bot_browser_get",
  "bot_browser_post",
  "game_assets_list",
  "game_assets_manifest",
  "game_assets_tree",
  "game_assets_rescan",
  "game_assets_create_folder",
  "game_assets_delete_folder",
  "game_assets_delete_file",
  "game_assets_read_text",
  "game_assets_write_text",
  "game_assets_rename",
  "game_assets_move",
  "game_assets_copy",
  "game_assets_move_bulk",
  "game_assets_copy_bulk",
  "game_assets_delete_bulk",
  "game_assets_file_info",
  "game_assets_folder_description",
  "game_assets_upload",
  "gif_config",
  "gif_update_config",
  "gif_search",
  "tts_config",
  "tts_update_config",
  "tts_voices",
  "tts_speak",
  "translate_text_command",
  "discord_webhook_send",
  "music_status",
  "music_search_candidates",
  "music_play",
  "music_pause",
  "music_stop",
  "music_set_volume",
  "music_fresh_pick",
  "spotify_status",
  "spotify_authorize",
  "spotify_exchange",
  "spotify_disconnect",
  "spotify_player",
  "spotify_devices",
  "spotify_access_token",
  "spotify_playlists",
  "spotify_playlist_tracks",
  "spotify_search_tracks",
  "spotify_play_track",
  "spotify_dj_deki_playlist",
  "spotify_dj_mari_playlist",
  "spotify_player_play",
  "spotify_player_pause",
  "spotify_player_next",
  "spotify_player_previous",
  "spotify_player_transfer",
  "spotify_player_volume",
  "spotify_player_shuffle",
  "spotify_player_repeat",
  "knowledge_sources_list",
  "knowledge_source_upload",
  "knowledge_source_delete",
  "knowledge_source_text",
  "import_marinara",
  "import_marinara_file",
  "import_st_character",
  "import_st_character_batch",
  "import_st_character_inspect",
  "import_st_chat",
  "import_st_chat_into_group",
  "import_st_preset",
  "import_st_lorebook",
  "import_list_directory",
  "import_st_bulk_scan",
  "import_st_bulk_run",
  "custom_tool_execute",
  "custom_tool_capabilities",
  "agent_patch_by_type",
  "agent_toggle_by_type",
  "agent_cadence_status",
  "storage_list",
  "lorebook_entries_list_by_lorebook_ids",
  "storage_get",
  "prompt_preset_bundle",
  "prompt_nested_reorder",
  "prompt_set_default",
  "theme_set_active",
  "chat_preset_set_active",
  "chat_folder_reorder",
  "regex_script_reorder",
  "storage_create",
  "storage_update",
  "storage_delete",
  "storage_duplicate",
  "connection_folder_reorder",
  "lorebook_entry_reorder",
  "lorebook_folder_reorder",
  "connection_move",
  "chat_message_add_swipe",
  "chat_message_update_content_if_unchanged",
  "chat_message_set_active_swipe",
  "chat_message_delete_swipe",
  "chat_evict_prompt_snapshots",
  "chat_autonomous_unread_mark",
  "chat_autonomous_unread_clear",
  "tracker_snapshot_latest",
  "tracker_snapshot_get",
  "tracker_snapshot_save",
  "chat_memories_list",
  "chat_memory_delete",
  "chat_memory_update",
  "chat_memory_soft_delete",
  "chat_memory_restore",
  "chat_memory_pin",
  "chat_memory_correct",
  "chat_memories_clear",
  "chat_memories_refresh",
  "chat_memories_migrate",
  "chat_memory_indexes_rebuild",
  "chat_memories_export",
  "chat_memories_import",
  "chat_notes_list",
  "chat_note_delete",
  "chat_notes_clear",
  "chat_group_delete",
  "chat_messages_bulk_delete",
  "chat_message_count",
  "chat_branch",
  "chat_message_swipes",
  "chat_connect",
  "chat_disconnect",
  "memory_create",
  "memory_get",
  "memory_update",
  "memory_delete",
  "memory_query",
  "memory_index_upsert",
  "memory_index_delete_for_memory",
  "memory_index_rebuild_lexical",
  "memory_index_query",
  "admin_expunge_command",
  "admin_clear_all_command",
  "agent_memory_get",
  "agent_memory_patch",
  "agent_memory_clear",
  "agent_runs_clear_for_chat",
  "agent_runs_list_for_chat",
  "agent_echo_messages_clear",
  "sprite_capabilities_command",
  "sprite_cleanup_status_command",
  "sprite_generate_sheet",
  "sprite_generate_sheet_preview",
  "sprite_cleanup",
  "sprite_list",
  "sprite_export",
  "sprite_upload",
  "sprite_upload_bulk",
  "sprite_delete",
  "sprite_cleanup_saved",
  "sprite_cleanup_restore",
  "avatar_generation_preview_command",
  "avatar_generation_command",
  "image_generate",
  "character_gallery_upload",
  "persona_gallery_upload",
  "global_gallery_upload",
  "chat_gallery_upload",
  "connection_test",
  "connection_test_message",
  "connection_test_image",
  "connection_diagnose_claude_subscription",
  "connection_models",
  "connection_save_default_parameters",
  "persona_activate",
  "character_avatar_upload",
  "character_avatar_remove",
  "avatar_thumbnail_file_path",
  "managed_asset_thumbnail_file_path",
  "character_restore_version",
  "persona_avatar_upload",
  "npc_avatar_upload",
  "lorebook_image_upload",
  "agent_image_upload",
  "agent_type_image_upload",
  "connection_image_upload",
  "llm_complete",
  "llm_embed",
  "llm_stream_cancel",
  "llm_list_models",
  "local_sidecar_status",
  "local_sidecar_log_tail",
  "local_sidecar_update_config",
  "local_sidecar_runtime_install",
  "local_sidecar_download_curated",
  "local_sidecar_list_huggingface_models",
  "local_sidecar_download_custom",
  "local_sidecar_download_cancel",
  "local_sidecar_delete_model",
  "local_sidecar_start",
  "local_sidecar_stop",
  "local_sidecar_restart",
  "local_sidecar_test_message",
  "deki_prompt",
  "deki_workspace_status",
  "deki_workspace_abort",
  "deki_workspace_approve",
  "deki_workspace_reject",
  "professor_mari_prompt",
  "update_check",
  "update_apply",
]);

const PRIVILEGED_REMOTE_COMMANDS = new Set([
  "profile_import",
  "backup_create",
  "backup_list",
  "backup_delete",
  "backup_download",
  "import_list_directory",
  "import_st_bulk_scan",
  "import_st_bulk_run",
  "admin_expunge_command",
  "admin_clear_all_command",
  "update_apply",
  "local_sidecar_status",
  "local_sidecar_log_tail",
  "local_sidecar_update_config",
  "local_sidecar_runtime_install",
  "local_sidecar_download_curated",
  "local_sidecar_list_huggingface_models",
  "local_sidecar_download_custom",
  "local_sidecar_download_cancel",
  "local_sidecar_delete_model",
  "local_sidecar_start",
  "local_sidecar_stop",
  "local_sidecar_restart",
  "local_sidecar_test_message",
]);
const ADMIN_SECRET_STORAGE_KEY = "marinara-admin-secret";
const LEGACY_ADMIN_SECRET_STORAGE_KEY = "marinara_admin_secret";
const REMOTE_RUNTIME_MARKERS = new Set(["de-koi-server", "marinara-server"]);

export type RuntimeTarget = {
  baseUrl: string;
  authorization?: string;
};

type RemoteRuntimeHealthPayload = {
  ok?: boolean;
  runtime?: string;
  writable?: boolean;
};

export type RemoteRuntimeHealthCheck =
  | { status: "ok"; message: string; health: RemoteRuntimeHealthPayload }
  | { status: "unconfigured"; message: string }
  | { status: "invalid"; message: string }
  | { status: "unreachable"; message: string; health?: RemoteRuntimeHealthPayload }
  | { status: "not-writable"; message: string; health: RemoteRuntimeHealthPayload };

export function hasEmbeddedTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const runtimeWindow = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(runtimeWindow.__TAURI__ || runtimeWindow.__TAURI_INTERNALS__);
}

export function sameOriginRemoteRuntimeUrl(): string {
  if (typeof window === "undefined" || hasEmbeddedTauriRuntime()) return "";
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return "";
  return window.location.origin;
}

export function unconfiguredRemoteRuntimeHealth(): RemoteRuntimeHealthCheck {
  return hasEmbeddedTauriRuntime()
    ? { status: "unconfigured", message: "Embedded Tauri runtime in use." }
    : { status: "unconfigured", message: "Remote Runtime URL is required in web-shell mode." };
}

function encodeBasicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`)}`;
}

function normalizeRemoteRuntimeUrl(raw: string): RuntimeTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const url = new URL(trimmed);
  let authorization: string | undefined;
  if (url.username || url.password) {
    authorization = encodeBasicAuth(url.username, url.password);
    url.username = "";
    url.password = "";
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return { baseUrl: url.toString().replace(/\/+$/, ""), authorization };
}

export function remoteRuntimeTarget(): RuntimeTarget | null {
  const configured = useUIStore.getState().remoteRuntimeUrl.trim();
  const raw = configured || sameOriginRemoteRuntimeUrl();
  try {
    return normalizeRemoteRuntimeUrl(raw);
  } catch {
    throw new ApiError("Invalid Remote Runtime URL. Check Settings and enter a valid runtime URL.", 400, {
      code: "invalid_remote_runtime_url",
    });
  }
}

export function isRemoteCommand(command: string): boolean {
  return REMOTE_COMMANDS.has(command);
}

export function remoteHeaders(target: RuntimeTarget, extra?: HeadersInit): HeadersInit {
  return {
    ...(target.authorization ? { Authorization: target.authorization } : {}),
    ...extra,
    "X-Marinara-CSRF": "1",
  };
}

export function remotePrivilegedHeaders(target: RuntimeTarget, extra?: HeadersInit): HeadersInit {
  return remoteHeaders(target, {
    ...extra,
    ...adminSecretHeader(),
  });
}

export function remoteFetchInit(init: RequestInit): RequestInit {
  return {
    ...init,
    cache: "no-store",
  };
}

function tryWriteAdminSecretStorage(write: () => void): void {
  try {
    write();
  } catch {
    // Reading a usable Admin Access value should not depend on best-effort key migration.
  }
}

export function readAdminSecretStorage(): string {
  if (typeof window === "undefined") return "";
  const current = window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY)?.trim() ?? "";
  if (current) {
    tryWriteAdminSecretStorage(() => window.localStorage.removeItem(LEGACY_ADMIN_SECRET_STORAGE_KEY));
    return current;
  }

  const legacy = window.localStorage.getItem(LEGACY_ADMIN_SECRET_STORAGE_KEY)?.trim() ?? "";
  if (!legacy) return "";

  tryWriteAdminSecretStorage(() => {
    window.localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, legacy);
    window.localStorage.removeItem(LEGACY_ADMIN_SECRET_STORAGE_KEY);
  });
  return legacy;
}

export function writeAdminSecretStorage(secret: string): void {
  if (typeof window === "undefined") return;
  const trimmed = secret.trim();
  if (trimmed) {
    window.localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
  }
  window.localStorage.removeItem(LEGACY_ADMIN_SECRET_STORAGE_KEY);
}

function adminSecretHeader(): HeadersInit {
  const secret = readAdminSecretStorage();
  return secret ? { "X-Admin-Secret": secret } : {};
}

function requestUsesLocalSidecar(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    readString(value.connectionId) === LOCAL_SIDECAR_CONNECTION_ID ||
    readString(value.connection_id) === LOCAL_SIDECAR_CONNECTION_ID
  );
}

function remoteInvokeRequiresAdmin(command: string, args?: Record<string, unknown>): boolean {
  if (PRIVILEGED_REMOTE_COMMANDS.has(command)) return true;
  if (command === "llm_complete") return requestUsesLocalSidecar(args?.request);
  if (command === "llm_embed") return requestUsesLocalSidecar(args?.body);
  return false;
}

function remoteInvokeHeaders(target: RuntimeTarget, command: string, args?: Record<string, unknown>): HeadersInit {
  return remoteHeaders(target, {
    "content-type": "application/json",
    ...(remoteInvokeRequiresAdmin(command, args) ? adminSecretHeader() : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSupportedRemoteRuntime(value: unknown): boolean {
  return typeof value === "string" && REMOTE_RUNTIME_MARKERS.has(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function remoteNetworkError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error ?? "Unknown network error");
  return new ApiError(
    "Remote runtime is unreachable. Check Settings and make sure the runtime server is running.",
    503,
    {
      code: "remote_runtime_unreachable",
      cause: error,
      causeMessage: message,
    },
  );
}

export async function checkRemoteRuntimeHealth(
  rawUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<RemoteRuntimeHealthCheck> {
  if (!rawUrl.trim()) {
    return unconfiguredRemoteRuntimeHealth();
  }

  let target: RuntimeTarget | null;
  try {
    target = normalizeRemoteRuntimeUrl(rawUrl);
  } catch {
    return { status: "invalid", message: "Remote Runtime URL is invalid." };
  }

  if (!target) {
    return unconfiguredRemoteRuntimeHealth();
  }

  try {
    const response = await fetch(
      `${target.baseUrl}/health?probe=1`,
      remoteFetchInit({
        method: "GET",
        headers: remoteHeaders(target, { accept: "application/json" }),
        signal: options.signal,
      }),
    );

    if (!response.ok) {
      return { status: "unreachable", message: `Remote runtime returned ${response.status}.` };
    }

    const body = (await response.json().catch(() => null)) as RemoteRuntimeHealthPayload | null;
    if (!body || typeof body !== "object" || body.ok !== true || !isSupportedRemoteRuntime(body.runtime)) {
      return { status: "unreachable", message: "Remote runtime did not return a compatible health response." };
    }

    if (body.writable !== true) {
      return {
        status: "not-writable",
        message: "Remote runtime is reachable, but its data storage is not writable.",
        health: body,
      };
    }

    const invokeReady = await fetch(
      `${target.baseUrl}/api/invoke`,
      remoteFetchInit({
        method: "POST",
        headers: remoteHeaders(target, { "content-type": "application/json" }),
        body: JSON.stringify({
          command: "storage_list",
          args: {
            entity: "chats",
            options: { fields: ["id"], limit: 1 },
          },
        }),
        signal: options.signal,
      }),
    );

    if (!invokeReady.ok) {
      if (invokeReady.status === 429) {
        return {
          status: "ok",
          message: "Remote runtime is online and storage is writable, but API requests are temporarily rate limited.",
          health: body,
        };
      }
      return {
        status: "unreachable",
        message: `Remote runtime health is reachable, but API invoke returned ${invokeReady.status}.`,
        health: body,
      };
    }

    return {
      status: "ok",
      message: "Remote runtime is online and storage is writable.",
      health: body,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { status: "unreachable", message: "Remote runtime is unreachable." };
  }
}

const REMOTE_ERROR_BODY_PREVIEW_CHARS = 500;

function retryAfterDetails(
  retryAfterMs: number | null,
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const base = details ?? {};
  if (retryAfterMs === null) return Object.keys(base).length ? base : undefined;
  return { ...base, retryAfterMs };
}

function summarizeRemoteErrorText(text: string): string | null {
  const normalized = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.length > REMOTE_ERROR_BODY_PREVIEW_CHARS
    ? normalized.slice(0, REMOTE_ERROR_BODY_PREVIEW_CHARS) + "..."
    : normalized;
}

export async function readRemoteError(response: Response): Promise<ApiError> {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  try {
    const body = await response.clone().json();
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const rawMessage =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : "Remote runtime returned " + response.status;
    const message = /Unsupported storage (?:entity|enity):?\s*deki-sessions/i.test(rawMessage)
      ? "This De-Koi server is older than the web app and cannot store Deki sessions. Update and restart the server, then refresh this page."
      : rawMessage;
    return new ApiError(message, response.status, retryAfterMs === null ? record : { ...record, retryAfterMs });
  } catch {
    const body = summarizeRemoteErrorText(await response.text().catch(() => ""));
    const message = "Remote runtime returned " + response.status;
    return new ApiError(
      body ? message + ": " + body : message,
      response.status,
      retryAfterDetails(retryAfterMs, body ? { body } : undefined),
    );
  }
}

function normalizeRemoteLlmChunk(event: LlmChunk): LlmChunk {
  const record = event as LlmChunk & { error?: unknown; message?: unknown };
  const data = isRecord(event.data) ? event.data : {};
  const text =
    typeof event.text === "string"
      ? event.text
      : typeof event.data === "string"
        ? event.data
        : typeof record.message === "string"
          ? record.message
          : typeof record.error === "string"
            ? record.error
            : typeof data.message === "string"
              ? data.message
              : typeof data.error === "string"
                ? data.error
                : undefined;
  return text === undefined ? event : { ...event, text };
}

export async function invokeRemote<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const target = remoteRuntimeTarget();
  if (!target) throw new ApiError("Remote runtime URL is not configured", 400);
  const body = JSON.stringify({ command, args: args ?? null });
  let response: Response;
  try {
    response = await fetch(
      `${target.baseUrl}/api/invoke`,
      remoteFetchInit({
        method: "POST",
        headers: remoteInvokeHeaders(target, command, args),
        body,
      }),
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw remoteNetworkError(error);
  }
  if (!response.ok) throw await readRemoteError(response);
  return (await response.json()) as T;
}

export async function* streamRemoteJsonEvents(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal; privileged?: boolean } = {},
): AsyncGenerator<{ type: string; data: unknown }> {
  const target = remoteRuntimeTarget();
  if (!target) throw new ApiError("Remote runtime URL is not configured", 400);
  const response = await fetch(
    `${target.baseUrl}${path}`,
    remoteFetchInit({
      method: "POST",
      headers: remoteHeaders(target, {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(options.privileged ? adminSecretHeader() : {}),
      }),
      body: JSON.stringify(body ?? null),
      signal: options.signal,
    }),
  );
  if (!response.ok) throw await readRemoteError(response);
  if (!response.body) throw new ApiError("Remote runtime did not return an event stream", 500);

  for await (const data of readSseEventData(response.body)) {
    yield parseRemoteJsonEvent(data);
  }
}

export async function* streamRemoteFormEvents(
  path: string,
  body: FormData,
  options: { signal?: AbortSignal; privileged?: boolean } = {},
): AsyncGenerator<{ type: string; data: unknown }> {
  const target = remoteRuntimeTarget();
  if (!target) throw new ApiError("Remote runtime URL is not configured", 400);
  const response = await fetch(
    `${target.baseUrl}${path}`,
    remoteFetchInit({
      method: "POST",
      headers: remoteHeaders(target, {
        accept: "text/event-stream",
        ...(options.privileged ? adminSecretHeader() : {}),
      }),
      body,
      signal: options.signal,
    }),
  );
  if (!response.ok) throw await readRemoteError(response);
  if (!response.body) throw new ApiError("Remote runtime did not return an event stream", 500);

  for await (const data of readSseEventData(response.body)) {
    yield parseRemoteJsonEvent(data);
  }
}

async function* readSseEventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseData(buffer);
      buffer = parsed.rest;
      for (const data of parsed.events) {
        yield data;
      }
    }
    const finalParsed = parseSseData(`${buffer}\n\n`);
    for (const data of finalParsed.events) {
      yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseRemoteJsonEvent(data: string): { type: string; data: unknown } {
  const event = JSON.parse(data) as { type?: unknown; data?: unknown; text?: unknown };
  const type = typeof event.type === "string" ? event.type : "message";
  if (type === "error") {
    const errorData = isRecord(event.data) ? event.data : {};
    throw new ApiError(
      readString(errorData.message) || readString(errorData.error) || "Remote event stream failed",
      500,
      event,
    );
  }
  return { type, data: "data" in event ? event.data : "text" in event ? event.text : event };
}

function parseSseData(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) events.push(data);
  }
  return { events, rest };
}

export async function* streamRemoteLlm(
  streamId: string,
  request: LlmRequest,
  target: RuntimeTarget,
  signal?: AbortSignal,
): AsyncGenerator<LlmChunk> {
  const response = await fetch(
    `${target.baseUrl}/api/llm/stream`,
    remoteFetchInit({
      method: "POST",
      headers: remoteHeaders(target, {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(requestUsesLocalSidecar(request) ? adminSecretHeader() : {}),
      }),
      body: JSON.stringify({ streamId, request }),
      signal,
    }),
  );
  if (!response.ok) throw await readRemoteError(response);
  if (!response.body) throw new ApiError("Remote runtime did not return a stream", 500);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseData(buffer);
      buffer = parsed.rest;
      for (const data of parsed.events) {
        const event = normalizeRemoteLlmChunk(JSON.parse(data) as LlmChunk);
        yield event;
        if (event.type === "error") return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function cancelRemoteLlmStream(
  streamId: string,
  target: RuntimeTarget | null,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  if (!target) return;
  await ignoreLlmStreamCancelFailure(
    "remote",
    streamId,
    (async () => {
      const response = await fetch(
        `${target.baseUrl}/api/llm/stream/${encodeURIComponent(streamId)}/cancel`,
        remoteFetchInit({
          method: "POST",
          headers: remoteHeaders(target),
          ...(options.keepalive === undefined ? {} : { keepalive: options.keepalive }),
        }),
      );
      if (!response.ok) throw await readRemoteError(response);
    })(),
  );
}
