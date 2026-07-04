import type { MusicDjIntent } from "../../../../shared/lib/music-dj-intent";

type RoleplayMusicMessage = {
  role?: string | null;
  content?: string | null;
};

export type RoleplayMusicContextInput = {
  chatName?: string | null;
  chatMeta?: Record<string, unknown> | null;
  characterNames?: readonly string[] | null;
  personaName?: string | null;
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

const RECENT_MESSAGE_LIMIT = 8;
const MAX_REASON_LENGTH = 140;
const DEFAULT_ROLEPLAY_STYLE = "cinematic roleplay instrumental ambience soundtrack";

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

function recentVisibleMessageText(messages: readonly RoleplayMusicMessage[]): string {
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

function inferMood(source: string): { mood: string; intensity: string } {
  if (includesAny(source, ["battle", "combat", "attack", "sword", "gunfire", "chase", "fight"])) {
    return { mood: "urgent tense", intensity: "high" };
  }
  if (includesAny(source, ["blood", "wound", "wounded", "injured", "pain", "copper", "limp", "dying"])) {
    return { mood: "somber wounded", intensity: "low" };
  }
  if (includesAny(source, ["sleep", "tired", "exhausted", "quiet", "whisper", "gentle", "morning"])) {
    return { mood: "quiet intimate", intensity: "low" };
  }
  if (includesAny(source, ["kiss", "embrace", "romance", "tender", "heart", "love"])) {
    return { mood: "tender romantic", intensity: "low" };
  }
  if (includesAny(source, ["horror", "terror", "dread", "monster", "haunted", "scream"])) {
    return { mood: "dark suspense", intensity: "medium" };
  }
  if (includesAny(source, ["grief", "cry", "tears", "lonely", "loss", "mourning"])) {
    return { mood: "melancholy emotional", intensity: "low" };
  }
  return { mood: "atmospheric", intensity: "medium" };
}

function inferSetting(source: string): string {
  if (includesAny(source, ["tavern", "inn", "ale", "hearth", "barmaid"])) return "fantasy tavern";
  if (includesAny(source, ["forest", "woods", "pine", "moss", "cabin", "campfire"])) return "forest cabin";
  if (includesAny(source, ["rain", "storm", "thunder", "window"])) return "rainy night";
  if (includesAny(source, ["castle", "king", "queen", "throne", "court"])) return "royal fantasy";
  if (includesAny(source, ["temple", "ruins", "ancient", "altar"])) return "ancient ruins";
  if (includesAny(source, ["ship", "sea", "sail", "harbor", "ocean"])) return "seafaring";
  if (includesAny(source, ["space", "ship", "neon", "cyber", "station", "android"])) return "sci fi";
  if (includesAny(source, ["school", "classroom", "campus", "dorm"])) return "modern slice of life";
  return "roleplay scene";
}

function inferGenre(source: string): string {
  if (includesAny(source, ["magic", "spell", "dragon", "kingdom", "elf", "fae", "fantasy"])) return "fantasy";
  if (includesAny(source, ["neon", "cyber", "space", "station", "android"])) return "sci fi";
  if (includesAny(source, ["detective", "case", "noir", "city", "rain"])) return "noir";
  if (includesAny(source, ["horror", "haunted", "monster", "dread"])) return "horror";
  return "cinematic";
}

export function buildRoleplayMusicContext(input: RoleplayMusicContextInput): RoleplayMusicContext | null {
  const chatMeta = input.chatMeta ?? {};
  const contextPieces = [
    readString(chatMeta.sceneDescription),
    readString(chatMeta.summary),
    readString(chatMeta.authorNotes),
    recentVisibleMessageText(input.messages ?? []),
  ].filter(Boolean);
  const characterNames = unique([...(input.characterNames ?? []), readString(input.personaName)]).slice(0, 4);

  if (contextPieces.length === 0 && characterNames.length === 0 && !readString(input.chatName)) return null;

  const source = normalizeWhitespace([...contextPieces, readString(input.chatName), ...characterNames].join(" "));
  const sourceLower = source.toLowerCase();
  const mood = inferMood(sourceLower);
  const setting = inferSetting(sourceLower);
  const genre = inferGenre(sourceLower);
  const query = unique([mood.mood, setting, genre, DEFAULT_ROLEPLAY_STYLE]).join(" ");

  return {
    query,
    intent: {
      mood: mood.mood,
      setting,
      intensity: mood.intensity,
      constraints: [genre, "instrumental", "avoid vocals"],
      reason: bounded(contextPieces[contextPieces.length - 1] ?? source, MAX_REASON_LENGTH),
    },
  };
}
