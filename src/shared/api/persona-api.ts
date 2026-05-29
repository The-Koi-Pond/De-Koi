import { invokeTauri } from "./tauri-client";

export const personaApi = {
  activate: (id: string) => invokeTauri("persona_activate", { id }),
  uploadAvatar: (id: string, avatar: string, filename?: string) =>
    invokeTauri("persona_avatar_upload", { id, body: { avatar, filename } }),
};
