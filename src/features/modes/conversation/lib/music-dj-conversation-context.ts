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

const RECENT_MESSAGE_LIMIT = 8;
const MAX_REASON_LENGTH = 140;
const DEFAULT_CONVERSATION_STYLE = "modern conversation instrumental ambience soundtrack";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bounded(value: string, maxLength: number): string {
  const clean = normalizeWhitespace(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function includesAny(source: string, terms: readonly string[]): boolean {
  return terms.some((term) => source.includes(term));
}

function unique(items: readonly string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function recentVisibleMessageText(messages: readonly ConversationMusicMessage[]): string {
  return messages
    .filter((message) => {
      const role = readString(message.role).toLowerCase();
      return role !== "system" && role !== "tool";
    })
    .slice(-RECENT_MESSAGE_LIMIT)
    .map((message) => readString(message.content))
    .filter(Boolean)
    .join(" ");
}

function profileCue(profile: ConversationMusicProfile | null | undefined): string {
  if (!profile) return "";
  return normalizeWhitespace(
    [
      readString(profile.name),
      readString(profile.description),
      readString(profile.personality),
      readString(profile.scenario),
      readString(profile.backstory),
      readString(profile.appearance),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function inferMood(source: string): { mood: string; intensity: string } {
  if (includesAny(source, ["argument", "angry", "fight", "upset", "panic", "scared", "worried"])) {
    return { mood: "tense conversation", intensity: "medium" };
  }
  if (includesAny(source, ["noir", "detective", "cyberpunk", "android", "neon"])) {
    return { mood: "noir conversation", intensity: "medium" };
  }
  if (includesAny(source, ["rain", "study", "coffee", "late night", "window", "exam", "homework"])) {
    return { mood: "cozy reflective", intensity: "low" };
  }
  if (includesAny(source, ["joke", "laugh", "smile", "funny", "teasing", "playful"])) {
    return { mood: "warm playful", intensity: "medium" };
  }
  if (includesAny(source, ["grief", "cry", "tears", "lonely", "loss", "mourning"])) {
    return { mood: "melancholy emotional", intensity: "low" };
  }
  if (includesAny(source, ["sleep", "tired", "quiet", "whisper", "gentle", "morning"])) {
    return { mood: "quiet intimate", intensity: "low" };
  }
  if (includesAny(source, ["flirt", "crush", "romance", "tender", "heart", "love"])) {
    return { mood: "tender romantic", intensity: "low" };
  }
  if (includesAny(source, ["focus", "coding", "project", "deadline", "work session"])) {
    return { mood: "focused calm", intensity: "medium" };
  }
  return { mood: "casual warm", intensity: "low" };
}

function inferSetting(source: string): string {
  if (includesAny(source, ["cyberpunk", "android", "neon", "rain-slick", "detective", "noir"])) return "neon city chat";
  if (includesAny(source, ["rain", "storm", "window"])) return "rainy room";
  if (includesAny(source, ["coffee", "cafe", "tea"])) return "cafe chat";
  if (includesAny(source, ["school", "class", "campus", "dorm", "exam", "homework"])) return "campus chat";
  if (includesAny(source, ["office", "work", "meeting", "deadline"])) return "work session";
  if (includesAny(source, ["text", "dm", "phone", "message"])) return "private messages";
  if (includesAny(source, ["stream", "game", "online"])) return "online hangout";
  if (includesAny(source, ["tavern", "inn", "hearth", "ale"])) return "fantasy tavern";
  return "modern conversation";
}

function inferGenre(source: string): string {
  if (includesAny(source, ["noir", "detective", "cyberpunk", "android", "neon"])) return "noir ambient";
  if (includesAny(source, ["rain", "study", "focus", "coding", "homework", "exam"])) return "lofi ambient";
  if (includesAny(source, ["romance", "flirt", "crush", "love"])) return "soft indie";
  if (includesAny(source, ["argument", "panic", "scared", "worried"])) return "subtle cinematic";
  if (includesAny(source, ["joke", "laugh", "playful", "teasing"])) return "warm acoustic";
  return "ambient";
}

export function buildConversationMusicContext(input: ConversationMusicContextInput): ConversationMusicContext | null {
  const chatMeta = input.chatMeta ?? {};
  const contextPieces = [
    readString(chatMeta.conversationSummary),
    readString(chatMeta.summary),
    readString(chatMeta.authorNotes),
    recentVisibleMessageText(input.messages ?? []),
  ].filter(Boolean);
  const characterNames = unique([...(input.characterNames ?? []), readString(input.personaName)]).slice(0, 4);
  const profilePieces = [
    ...(input.characterProfiles ?? []).map(profileCue),
    profileCue(input.personaProfile),
  ].filter(Boolean);

  if (contextPieces.length === 0 && profilePieces.length === 0 && characterNames.length === 0 && !readString(input.chatName)) return null;

  const source = normalizeWhitespace([...contextPieces, ...profilePieces, readString(input.chatName), ...characterNames].join(" "));
  const sourceLower = source.toLowerCase();
  const mood = inferMood(sourceLower);
  const setting = inferSetting(sourceLower);
  const genre = inferGenre(sourceLower);
  const query = unique([mood.mood, setting, genre, DEFAULT_CONVERSATION_STYLE]).join(" ");
  const reasonSource = unique([contextPieces[contextPieces.length - 1] ?? "", ...profilePieces]).join(" ") || source;

  return {
    query,
    intent: {
      mood: mood.mood,
      setting,
      intensity: mood.intensity,
      constraints: [genre, "instrumental", "avoid vocals"],
      reason: bounded(reasonSource, MAX_REASON_LENGTH),
    },
  };
}
