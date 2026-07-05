import type { MusicDjIntent } from "../../../../shared/lib/music-dj-intent";

type RoleplayMusicMessage = {
  role?: string | null;
  content?: string | null;
};

type RoleplayMusicProfile = {
  name?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

export type RoleplayMusicContextInput = {
  chatName?: string | null;
  chatMeta?: Record<string, unknown> | null;
  characterNames?: readonly string[] | null;
  characterProfiles?: readonly RoleplayMusicProfile[] | null;
  personaName?: string | null;
  personaProfile?: RoleplayMusicProfile | null;
  messages?: readonly RoleplayMusicMessage[] | null;
};

export type RoleplayMusicContext = {
  query: string;
  intent: MusicDjIntent;
};

export function shouldDispatchRoleplayMusicContext(
  chatMode: string | null | undefined,
  context: RoleplayMusicContext | null | undefined,
  _enabledAgentTypes?: ReadonlySet<string>,
): context is RoleplayMusicContext {
  void context;
  return chatMode === "roleplay";
}

export function buildRoleplayMusicContext(_input: RoleplayMusicContextInput): RoleplayMusicContext | null {
  return null;
}
