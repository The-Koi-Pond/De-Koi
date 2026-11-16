import {
  fileToUploadPayload,
  KNOWLEDGE_SOURCE_UPLOAD_SIZE_ERROR,
  MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES,
} from "./file-payload";
import { openExternalUrl } from "./external-link-api";
import { invokeTauri } from "./tauri-client";

interface GifSearchResult {
  id: string;
  title: string;
  preview: string;
  url: string;
  width: number;
  height: number;
}

export interface GifSearchResponse {
  results: GifSearchResult[];
  next: string;
}

export interface GifConfigResponse {
  hasApiKey: boolean;
  apiKey?: string | null;
  source: "stored" | "env" | "missing";
  envConfigured: boolean;
}

export const gifsApi = {
  config: () => invokeTauri<GifConfigResponse>("gif_config"),
  updateConfig: (input: { apiKey: string }) =>
    invokeTauri<GifConfigResponse>("gif_update_config", { body: { apiKey: input.apiKey } }),
  openApiKeyPage: () => openExternalUrl("https://developers.giphy.com/dashboard/?create=true"),
  search: (input: { q?: string; limit?: number; pos?: string }) => {
    return invokeTauri<GifSearchResponse>("gif_search", {
      q: input.q?.trim() || null,
      limit: input.limit ?? 20,
      pos: input.pos ?? null,
    });
  },
};

export const knowledgeSourcesApi = {
  list: <T = unknown>() => invokeTauri<T>("knowledge_sources_list"),
  upload: (file: File) => {
    return fileToUploadPayload(file, {
      maxBytes: MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES,
      tooLargeMessage: KNOWLEDGE_SOURCE_UPLOAD_SIZE_ERROR,
    }).then((payload) =>
      invokeTauri("knowledge_source_upload", {
        body: { file: payload },
      }),
    );
  },
  delete: <T = unknown>(id: string) => invokeTauri<T>("knowledge_source_delete", { id }),
  text: <T = unknown>(id: string) => invokeTauri<T>("knowledge_source_text", { id }),
};

export const connectionsUtilityApi = {
  list: <T = unknown>() => invokeTauri<T>("storage_list", { entity: "connections", options: null }),
};
