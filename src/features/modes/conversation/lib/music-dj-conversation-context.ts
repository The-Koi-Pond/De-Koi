import type { MusicDjIntent } from "../../../../shared/lib/music-dj-intent";

type ConversationMusicMessage = {
  role?: string | null;
  content?: string | null;
};

type ConversationMusicProfile = {
  name?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

export type ConversationMusicContextInput = {
  chatName?: string | null;
  chatMeta?: Record<string, unknown> | null;
  characterNames?: readonly string[] | null;
  characterProfiles?: readonly ConversationMusicProfile[] | null;
  personaName?: string | null;
  personaProfile?: ConversationMusicProfile | null;
  messages?: readonly ConversationMusicMessage[] | null;
};

export type ConversationMusicContext = {
  query: string;
  intent: MusicDjIntent;
};

export function buildConversationMusicContext(_input: ConversationMusicContextInput): ConversationMusicContext | null {
  return null;
}
