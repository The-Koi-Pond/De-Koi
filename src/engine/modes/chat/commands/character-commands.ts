// ──────────────────────────────────────────────
// Service: Character Commands
// ──────────────────────────────────────────────
// Parses hidden commands from character messages in Conversation mode.
// Commands are embedded by the LLM in the response and stripped before
// the message is shown to the user.
//
// Supported commands:
// - [schedule_update: status="online", activity="free time"]
// - [cross_post: target="group"] or [cross_post: target="CharName"]
// - [selfie], [selfie: context="description of the selfie"], [selfie: "description"], or [selfie: description]
// - [memory: target="CharName", summary="description of the memory"]
// - [scene: scenario="...", background="...", plan="..."] (initiate a mini-roleplay scene)
// - [spotify: title="Song title", artist="Artist"] (play a song on the user's active Spotify player)
// - <influence>text</influence> (OOC influence for connected roleplay, one-shot)
// - <note>text</note> (durable note for connected roleplay, persists until cleared)
// - [dm: character="CharName", message="text"] (Roleplay-only: open a direct-message conversation)
//
// Assistant commands (Deki-senpai):
// - [create_persona: name="...", description="...", personality="...", appearance="..."]
// - [create_character: name="...", description="...", personality="...", first_message="...", scenario="...", backstory="...", appearance="...", mes_example="...", creator_notes="...", system_prompt="...", post_history_instructions="...", creator="...", character_version="...", tags="tag1, tag2", alternate_greetings="hello || hi", talkativeness=0.5, fav=true, world="...", depth_prompt="...", depth_prompt_depth=4, depth_prompt_role="system"]
// - [update_character: name="...", description="...", personality="...", first_message="...", scenario="...", backstory="...", appearance="...", mes_example="...", creator_notes="...", system_prompt="...", post_history_instructions="...", creator="...", character_version="...", tags="tag1, tag2", alternate_greetings="hello || hi", talkativeness=0.5, fav=true, world="...", depth_prompt="...", depth_prompt_depth=4, depth_prompt_role="system"]
// - [update_persona: name="...", description="...", personality="...", appearance="...", scenario="...", backstory="..."]
// - <create_lorebook>{"name":"...","description":"...","category":"...","tags":["..."],"entries":[{"name":"...","content":"...","keys":["..."],"tag":"..."}]}</create_lorebook>
// - <update_lorebook>{"name":"Existing","description":"...","entries":[{"name":"Entry","content":"refined content","keys":["..."]}]}</update_lorebook>
// - [create_chat: character="...", mode="conversation|roleplay"]
// - [navigate: panel="...", tab="..."]
// - [fetch: type="character|persona|lorebook|chat|preset", name="..."]

import { stripConversationPromptTimestamps } from "../core/summaries/transcript-sanitize.js";

interface ScheduleUpdateCommand {
  type: "schedule_update";
  status?: "online" | "idle" | "dnd" | "offline";
  activity?: string;
  duration?: string;
}

interface CrossPostCommand {
  type: "cross_post";
  /** "group" to post in a group chat, or a character/chat name for DM */
  target: string;
}

interface SelfieCommand {
  type: "selfie";
  /** Optional context hint from the character about the selfie */
  context?: string;
}

interface MemoryCommand {
  type: "memory";
  /** Target character name */
  target: string;
  /** Short description of the memory */
  summary: string;
}

interface SceneCommand {
  type: "scene";
  /** Description of the scene/scenario the character wants to play out */
  scenario: string;
  /** Optional background suggestion */
  background?: string;
  /** Optional plot plan / outline for how the scene unfolds */
  plan?: string;
}

interface InfluenceCommand {
  type: "influence";
  /** The OOC influence text to inject into the connected roleplay */
  content: string;
}

interface NoteCommand {
  type: "note";
  /** The durable note text to persist in the connected roleplay's prompt until cleared */
  content: string;
}

export interface DirectMessageCommand {
  type: "dm";
  /** Target character name or ID */
  character: string;
  /** Text the character sends in the generated conversation DM */
  message: string;
  /** Exact hidden command text to remove or replace after target resolution. */
  raw?: string;
  /** Resolved target character ID, set by connected-command execution. */
  resolvedCharacterId?: string;
  /** Resolved target character name, set by connected-command execution. */
  resolvedCharacterName?: string;
}

interface SpotifyCommand {
  type: "spotify";
  /** Exact song title to play */
  title: string;
  /** Artist name to disambiguate the track */
  artist: string;
}

// ── Assistant commands (Deki-senpai) ──

export interface CreatePersonaCommand {
  type: "create_persona";
  name: string;
  description?: string;
  personality?: string;
  appearance?: string;
}

export interface CreateCharacterCommand {
  type: "create_character";
  name: string;
  description?: string;
  personality?: string;
  firstMessage?: string;
  scenario?: string;
  backstory?: string;
  appearance?: string;
  mesExample?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  creator?: string;
  characterVersion?: string;
  tags?: string[];
  alternateGreetings?: string[];
  talkativeness?: number;
  fav?: boolean;
  world?: string;
  depthPrompt?: string;
  depthPromptDepth?: number;
  depthPromptRole?: "system" | "user" | "assistant";
}

export interface UpdateCharacterCommand {
  type: "update_character";
  name: string;
  description?: string;
  personality?: string;
  firstMessage?: string;
  scenario?: string;
  backstory?: string;
  appearance?: string;
  mesExample?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  creator?: string;
  characterVersion?: string;
  tags?: string[];
  alternateGreetings?: string[];
  talkativeness?: number;
  fav?: boolean;
  world?: string;
  depthPrompt?: string;
  depthPromptDepth?: number;
  depthPromptRole?: "system" | "user" | "assistant";
}

export interface UpdatePersonaCommand {
  type: "update_persona";
  name: string;
  description?: string;
  personality?: string;
  appearance?: string;
  scenario?: string;
  backstory?: string;
}

interface CreateLorebookEntryCommand {
  name: string;
  content?: string;
  description?: string;
  keys?: string[];
  secondaryKeys?: string[];
  tag?: string;
  constant?: boolean;
  selective?: boolean;
}

interface UpdateLorebookEntryCommand extends CreateLorebookEntryCommand {
  /** Existing entry name to match when renaming or disambiguating. Defaults to name. */
  matchName?: string;
}

export interface CreateLorebookCommand {
  type: "create_lorebook";
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  entries?: CreateLorebookEntryCommand[];
}

export interface UpdateLorebookCommand {
  type: "update_lorebook";
  /** Existing lorebook name to update. */
  name: string;
  /** Optional new display name for the lorebook. */
  newName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  entries?: UpdateLorebookEntryCommand[];
}

interface CreatePresetGroupCommand {
  id?: string;
  name: string;
  parentGroupId?: string | null;
  order?: number;
  enabled?: boolean;
}

interface CreatePresetSectionCommand {
  id?: string;
  identifier?: string;
  name: string;
  content?: string;
  role?: "system" | "user" | "assistant";
  enabled?: boolean;
  isMarker?: boolean;
  groupId?: string | null;
  markerConfig?: Record<string, unknown> | null;
  injectionPosition?: "ordered" | "depth";
  injectionDepth?: number;
  injectionOrder?: number;
  order?: number;
  forbidOverrides?: boolean;
}

interface CreatePresetChoiceOptionCommand {
  id?: string;
  label: string;
  value: string;
}

interface CreatePresetChoiceBlockCommand {
  id?: string;
  variableName: string;
  question: string;
  options: CreatePresetChoiceOptionCommand[];
  multiSelect?: boolean;
  separator?: string;
  randomPick?: boolean;
  sortOrder?: number;
}

export interface CreatePresetCommand {
  type: "create_preset";
  name: string;
  description?: string;
  wrapFormat?: "xml" | "markdown" | "none";
  author?: string;
  groups?: CreatePresetGroupCommand[];
  sections?: CreatePresetSectionCommand[];
  choiceBlocks?: CreatePresetChoiceBlockCommand[];
  variableGroups?: Array<Record<string, unknown>>;
  variableValues?: Record<string, string>;
  defaultChoices?: Record<string, string | string[]>;
  parameters?: Record<string, unknown>;
}

interface CreateChatCommand {
  type: "create_chat";
  character: string;
  mode?: "conversation" | "roleplay";
}

interface NavigateCommand {
  type: "navigate";
  panel: string;
  tab?: string;
}

interface FetchCommand {
  type: "fetch";
  /** What kind of item to fetch */
  fetchType: "character" | "persona" | "lorebook" | "chat" | "preset";
  /** Name of the item to retrieve */
  name: string;
}

type AssistantCommand =
  | CreatePersonaCommand
  | CreateCharacterCommand
  | UpdateCharacterCommand
  | UpdatePersonaCommand
  | CreateLorebookCommand
  | UpdateLorebookCommand
  | CreatePresetCommand
  | CreateChatCommand
  | NavigateCommand
  | FetchCommand;

export type CharacterCommand =
  | ScheduleUpdateCommand
  | CrossPostCommand
  | SelfieCommand
  | MemoryCommand
  | SceneCommand
  | InfluenceCommand
  | NoteCommand
  | DirectMessageCommand
  | SpotifyCommand
  | AssistantCommand;

// Param block matcher: any char that isn't `"` or `]`, OR a complete
// double-quoted string (with `\"`-style escapes). Lets a `]` inside a
// quoted parameter value (e.g. `description="Status: [VIP]"`) sit inside
// the command instead of terminating it early. The inner alternative
// excludes `\\` so backslash is only consumed by the escape branch —
// otherwise an escape-heavy value can trigger catastrophic backtracking.
const QUOTED_PARAM_BLOCK = '(?:[^"\\]]|"(?:\\\\.|[^"\\\\])*")*';

/** Regex patterns for each command type */
const SCHEDULE_UPDATE_RE = new RegExp(`\\[schedule_update:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CROSS_POST_RE = /\[cross_post:\s*target="([^"]+)"\]/gi;
const SELFIE_RE = /\[selfie(?::\s*(?:context="([^"]*)"|"([^"]*)"|([^\]\r\n"]+)))?\]/gi;
const MEMORY_RE = /\[memory:\s*target="([^"]+)"\s*,\s*summary="([^"]+)"\]/gi;
const BARE_MEMORY_RE = new RegExp(`\\[memory:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const SCENE_RE = new RegExp(`\\[scene:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const SPOTIFY_RE = new RegExp(`\\[spotify:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const DIRECT_MESSAGE_RE = new RegExp(`\\[dm:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const INFLUENCE_RE = /<influence>([\s\S]*?)<\/influence>/gi;
const NOTE_RE = /<note>([\s\S]*?)<\/note>/gi;

// Assistant command regexes
const CREATE_PERSONA_RE = new RegExp(`\\[create_persona:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CREATE_CHARACTER_RE = new RegExp(`\\[create_character:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const UPDATE_CHARACTER_RE = new RegExp(`\\[update_character:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const UPDATE_PERSONA_RE = new RegExp(`\\[update_persona:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CREATE_LOREBOOK_RE = new RegExp(`\\[create_lorebook:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CREATE_LOREBOOK_BLOCK_RE = /<create_lorebook>([\s\S]*?)<\/create_lorebook>/gi;
const UPDATE_LOREBOOK_BLOCK_RE = /<update_lorebook>([\s\S]*?)<\/update_lorebook>/gi;
const CREATE_PRESET_BLOCK_RE = /<create_preset>([\s\S]*?)<\/create_preset>/gi;
const CREATE_CHAT_RE = new RegExp(`\\[create_chat:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const NAVIGATE_RE = new RegExp(`\\[navigate:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const FETCH_RE = new RegExp(`\\[fetch:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");

function decodeQuotedParamValue(value: string): string {
  return value.replace(/\\(["\\nrt])/g, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return escaped;
    }
  });
}

const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "\u201c": "\u201d",
  "\u201d": "\u201d",
  "\u2018": "\u2019",
  "\u2019": "\u2019",
};

function parseQuotedParam(params: string, key: string, allowEmpty = false): string | undefined {
  const match = params.match(new RegExp(`${key}\\s*=\\s*(["\u201c\u201d\u2018\u2019])`));
  if (!match || match.index === undefined) return undefined;

  const openingQuote = match[1] ?? '"';
  const closingQuote = QUOTE_PAIRS[openingQuote] ?? openingQuote;
  let rawValue = "";
  let index = match.index + match[0].length;

  while (index < params.length) {
    const char = params[index] ?? "";
    const nextChar = params[index + 1];

    if (char === "\\" && nextChar !== undefined) {
      rawValue += char + nextChar;
      index += 2;
      continue;
    }

    const remainder = params.slice(index + 1).trimStart();
    if (
      char === closingQuote &&
      (remainder.length === 0 || remainder.startsWith(",") || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(remainder))
    ) {
      break;
    }

    rawValue += char;
    index += 1;
  }

  if (index >= params.length) return undefined;

  const value = decodeQuotedParamValue(rawValue);
  if (!allowEmpty && value.length === 0) return undefined;
  return value;
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  const openingQuote = trimmed[0] ?? "";
  const closingQuote = QUOTE_PAIRS[openingQuote];
  if (!closingQuote || !trimmed.endsWith(closingQuote)) return trimmed;
  return trimmed.slice(1, -1).trim();
}

function parseLeadingQuotedValue(value: string): string | undefined {
  const openingQuote = value.trimStart()[0] ?? "";
  const closingQuote = QUOTE_PAIRS[openingQuote];
  if (!closingQuote) return undefined;

  let rawValue = "";
  let index = value.indexOf(openingQuote) + openingQuote.length;
  while (index < value.length) {
    const char = value[index] ?? "";
    const nextChar = value[index + 1];

    if (char === "\\" && nextChar !== undefined) {
      rawValue += char + nextChar;
      index += 2;
      continue;
    }
    if (char === closingQuote) return decodeQuotedParamValue(rawValue);

    rawValue += char;
    index += 1;
  }

  return undefined;
}

function parseBareMemoryCommand(params: string): MemoryCommand | null {
  if (/^\s*target\s*=/i.test(params)) return null;

  const commaIndex = params.indexOf(",");
  if (commaIndex < 0) return null;

  const target = stripMatchingQuotes(params.slice(0, commaIndex));
  const summary = parseLeadingQuotedValue(params.slice(commaIndex + 1));
  if (!target || !summary) return null;

  return { type: "memory", target, summary };
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) return [];
  const delimiter = value.includes("||") ? "||" : ",";
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanParam(params: string, key: string): boolean | undefined {
  const match = params.match(new RegExp(`${key}=(true|false)`, "i"));
  if (!match) return undefined;
  return match[1]?.toLowerCase() === "true";
}

function parseUnknownStringList(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const values = raw.map((value) => String(value).trim()).filter(Boolean);
    return values.length ? values : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const values = parseStringList(raw);
  return values && values.length ? values : undefined;
}

function parseLorebookEntriesParam(raw: string): CreateLorebookEntryCommand[] | undefined {
  const entries = raw
    .split(/\s*\|\|\s*/)
    .map((chunk): CreateLorebookEntryCommand | null => {
      const [name, keys, content, description] = chunk.split(/\s*\|\s*/);
      const entryName = name?.trim();
      if (!entryName) return null;
      return {
        name: entryName,
        keys: parseUnknownStringList(keys),
        content: content?.trim() || "",
        description: description?.trim() || undefined,
      } satisfies CreateLorebookEntryCommand;
    })
    .filter((entry): entry is CreateLorebookEntryCommand => entry !== null);
  return entries.length ? entries : undefined;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseLorebookBlock(raw: string): CreateLorebookCommand | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;

    const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const entries = rawEntries
      .map((entry): CreateLorebookEntryCommand | null => {
        if (!entry || typeof entry !== "object") return null;
        const data = entry as Record<string, unknown>;
        const entryName = typeof data.name === "string" ? data.name.trim() : "";
        if (!entryName) return null;
        return {
          name: entryName,
          content: typeof data.content === "string" ? data.content : "",
          description: typeof data.description === "string" ? data.description : undefined,
          keys: parseUnknownStringList(data.keys),
          secondaryKeys: parseUnknownStringList(data.secondaryKeys),
          tag: typeof data.tag === "string" ? data.tag : undefined,
          constant: typeof data.constant === "boolean" ? data.constant : undefined,
          selective: typeof data.selective === "boolean" ? data.selective : undefined,
        } satisfies CreateLorebookEntryCommand;
      })
      .filter((entry): entry is CreateLorebookEntryCommand => entry !== null);

    return {
      type: "create_lorebook",
      name,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      category: typeof parsed.category === "string" ? parsed.category : undefined,
      tags: parseUnknownStringList(parsed.tags),
      entries: entries.length ? entries : undefined,
    };
  } catch {
    return null;
  }
}

function parseStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw)
    .map(([key, value]) => [key, typeof value === "string" ? value : String(value)] as const)
    .filter(([key]) => key.trim().length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseDefaultChoices(raw: unknown): Record<string, string | string[]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries: Array<[string, string | string[]]> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim()) continue;
    if (typeof value === "string") {
      entries.push([key, value]);
    } else if (Array.isArray(value)) {
      entries.push([key, value.map((item) => String(item))]);
    }
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parsePresetBlock(raw: string): CreatePresetCommand | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;

    const groups = (Array.isArray(parsed.groups) ? parsed.groups : [])
      .map((group): CreatePresetGroupCommand | null => {
        if (!group || typeof group !== "object") return null;
        const data = group as Record<string, unknown>;
        const groupName = typeof data.name === "string" ? data.name.trim() : "";
        if (!groupName) return null;
        return {
          id: typeof data.id === "string" ? data.id.trim() || undefined : undefined,
          name: groupName,
          parentGroupId:
            typeof data.parentGroupId === "string"
              ? data.parentGroupId.trim() || null
              : data.parentGroupId === null
                ? null
                : undefined,
          order: typeof data.order === "number" && Number.isFinite(data.order) ? Math.floor(data.order) : undefined,
          enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
        };
      })
      .filter((group): group is CreatePresetGroupCommand => group !== null);

    const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
      .map((section): CreatePresetSectionCommand | null => {
        if (!section || typeof section !== "object") return null;
        const data = section as Record<string, unknown>;
        const sectionName = typeof data.name === "string" ? data.name.trim() : "";
        if (!sectionName) return null;
        const role = data.role === "user" || data.role === "assistant" ? data.role : "system";
        const injectionPosition = data.injectionPosition === "depth" ? "depth" : "ordered";
        return {
          id: typeof data.id === "string" ? data.id.trim() || undefined : undefined,
          identifier: typeof data.identifier === "string" ? data.identifier.trim() || undefined : undefined,
          name: sectionName,
          content: typeof data.content === "string" ? data.content : undefined,
          role,
          enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
          isMarker: typeof data.isMarker === "boolean" ? data.isMarker : undefined,
          groupId:
            typeof data.groupId === "string" ? data.groupId.trim() || null : data.groupId === null ? null : undefined,
          markerConfig:
            data.markerConfig && typeof data.markerConfig === "object" && !Array.isArray(data.markerConfig)
              ? (data.markerConfig as Record<string, unknown>)
              : data.markerConfig === null
                ? null
                : undefined,
          injectionPosition,
          injectionDepth:
            typeof data.injectionDepth === "number" && Number.isFinite(data.injectionDepth)
              ? Math.max(0, Math.floor(data.injectionDepth))
              : undefined,
          injectionOrder:
            typeof data.injectionOrder === "number" && Number.isFinite(data.injectionOrder)
              ? Math.floor(data.injectionOrder)
              : undefined,
          order: typeof data.order === "number" && Number.isFinite(data.order) ? Math.floor(data.order) : undefined,
          forbidOverrides: typeof data.forbidOverrides === "boolean" ? data.forbidOverrides : undefined,
        };
      })
      .filter((section): section is CreatePresetSectionCommand => section !== null);

    const choiceBlocks = (Array.isArray(parsed.choiceBlocks) ? parsed.choiceBlocks : [])
      .map((block): CreatePresetChoiceBlockCommand | null => {
        if (!block || typeof block !== "object") return null;
        const data = block as Record<string, unknown>;
        const variableName = typeof data.variableName === "string" ? data.variableName.trim() : "";
        const question = typeof data.question === "string" ? data.question.trim() : "";
        const options = (Array.isArray(data.options) ? data.options : [])
          .map((option): CreatePresetChoiceOptionCommand | null => {
            if (!option || typeof option !== "object") return null;
            const optionData = option as Record<string, unknown>;
            const label = typeof optionData.label === "string" ? optionData.label.trim() : "";
            const value = typeof optionData.value === "string" ? optionData.value : "";
            if (!label) return null;
            return {
              id: typeof optionData.id === "string" ? optionData.id.trim() || undefined : undefined,
              label,
              value,
            };
          })
          .filter((option): option is CreatePresetChoiceOptionCommand => option !== null);
        if (!variableName || !question || options.length === 0) return null;
        return {
          id: typeof data.id === "string" ? data.id.trim() || undefined : undefined,
          variableName,
          question,
          options,
          multiSelect: typeof data.multiSelect === "boolean" ? data.multiSelect : undefined,
          separator: typeof data.separator === "string" ? data.separator : undefined,
          randomPick: typeof data.randomPick === "boolean" ? data.randomPick : undefined,
          sortOrder:
            typeof data.sortOrder === "number" && Number.isFinite(data.sortOrder)
              ? Math.floor(data.sortOrder)
              : undefined,
        };
      })
      .filter((block): block is CreatePresetChoiceBlockCommand => block !== null);

    return {
      type: "create_preset",
      name,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      wrapFormat:
        parsed.wrapFormat === "markdown" || parsed.wrapFormat === "none" || parsed.wrapFormat === "xml"
          ? parsed.wrapFormat
          : undefined,
      author: typeof parsed.author === "string" ? parsed.author : undefined,
      groups: groups.length ? groups : undefined,
      sections: sections.length ? sections : undefined,
      choiceBlocks: choiceBlocks.length ? choiceBlocks : undefined,
      variableGroups: Array.isArray(parsed.variableGroups)
        ? parsed.variableGroups.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        : undefined,
      variableValues: parseStringRecord(parsed.variableValues),
      defaultChoices: parseDefaultChoices(parsed.defaultChoices),
      parameters:
        parsed.parameters && typeof parsed.parameters === "object" && !Array.isArray(parsed.parameters)
          ? (parsed.parameters as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return null;
  }
}

function parseUpdateLorebookBlock(raw: string): UpdateLorebookCommand | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;

    const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const entries = rawEntries
      .map((entry): UpdateLorebookEntryCommand | null => {
        if (!entry || typeof entry !== "object") return null;
        const data = entry as Record<string, unknown>;
        const entryName = typeof data.name === "string" ? data.name.trim() : "";
        if (!entryName) return null;
        return {
          name: entryName,
          matchName: typeof data.matchName === "string" ? data.matchName.trim() : undefined,
          content: typeof data.content === "string" ? data.content : undefined,
          description: typeof data.description === "string" ? data.description : undefined,
          keys: parseUnknownStringList(data.keys),
          secondaryKeys: parseUnknownStringList(data.secondaryKeys),
          tag: typeof data.tag === "string" ? data.tag : undefined,
          constant: typeof data.constant === "boolean" ? data.constant : undefined,
          selective: typeof data.selective === "boolean" ? data.selective : undefined,
        } satisfies UpdateLorebookEntryCommand;
      })
      .filter((entry): entry is UpdateLorebookEntryCommand => entry !== null);

    return {
      type: "update_lorebook",
      name,
      newName: typeof parsed.newName === "string" ? parsed.newName.trim() : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      category: typeof parsed.category === "string" ? parsed.category : undefined,
      tags: parseUnknownStringList(parsed.tags),
      entries: entries.length ? entries : undefined,
    };
  } catch {
    return null;
  }
}

function parseNumberParam(params: string, key: string): number | undefined {
  const match = params.match(new RegExp(`${key}=(-?[0-9]+(?:\\.[0-9]+)?)(?=$|[\\s,])`, "i"));
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(value) ? value : undefined;
}

function parseUnquotedSceneParam(params: string, key: string): string | undefined {
  const match = params.match(
    new RegExp(`${key}\\s*=\\s*([\\s\\S]*?)(?=\\s*,?\\s*(?:scenario|description|prompt|background|plan)\\s*=|$)`, "i"),
  );
  const value = match?.[1]?.replace(/,\s*$/, "").trim();
  return value || undefined;
}

function parseSceneTextParam(params: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const quoted = parseQuotedParam(params, key);
    if (quoted) return quoted.trim();
    const unquoted = parseUnquotedSceneParam(params, key);
    if (unquoted) return unquoted;
  }
  return undefined;
}

function parseBareSceneScenario(params: string): string | undefined {
  const trimmed = params.trim();
  if (!trimmed || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) return undefined;
  const quote = trimmed[0];
  const closeQuote = quote === "\u201c" ? "\u201d" : quote === "\u2018" ? "\u2019" : quote;
  if ((quote === '"' || quote === "'" || quote === "\u201c" || quote === "\u2018") && trimmed.endsWith(closeQuote)) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
}

function applyCommonCharacterFields(
  cmd: CreateCharacterCommand | UpdateCharacterCommand,
  params: string,
  options: { allowEmptyStrings: boolean },
) {
  const readText = (key: string) => parseQuotedParam(params, key, options.allowEmptyStrings);
  const assignText = <K extends keyof CreateCharacterCommand & keyof UpdateCharacterCommand>(
    key: K,
    paramName: string,
  ) => {
    const value = readText(paramName);
    if (value !== undefined) {
      cmd[key] = value as CreateCharacterCommand[K] & UpdateCharacterCommand[K];
    }
  };

  assignText("description", "description");
  assignText("personality", "personality");
  assignText("firstMessage", "first_message");
  assignText("scenario", "scenario");
  assignText("backstory", "backstory");
  assignText("appearance", "appearance");
  assignText("mesExample", "mes_example");
  assignText("creatorNotes", "creator_notes");
  assignText("systemPrompt", "system_prompt");
  assignText("postHistoryInstructions", "post_history_instructions");
  assignText("creator", "creator");
  assignText("characterVersion", "character_version");
  assignText("world", "world");
  assignText("depthPrompt", "depth_prompt");

  const tags = parseStringList(readText("tags"));
  if (tags !== undefined) cmd.tags = tags;

  const alternateGreetings = parseStringList(readText("alternate_greetings"));
  if (alternateGreetings !== undefined) cmd.alternateGreetings = alternateGreetings;

  const talkativeness = parseNumberParam(params, "talkativeness");
  if (talkativeness !== undefined) {
    cmd.talkativeness = Math.max(0, Math.min(1, talkativeness));
  }

  const fav = parseBooleanParam(params, "fav");
  if (fav !== undefined) cmd.fav = fav;

  const depthPromptDepth = parseNumberParam(params, "depth_prompt_depth");
  if (depthPromptDepth !== undefined) {
    cmd.depthPromptDepth = Math.max(0, Math.floor(depthPromptDepth));
  }

  const depthPromptRole = readText("depth_prompt_role");
  if (depthPromptRole === "system" || depthPromptRole === "user" || depthPromptRole === "assistant") {
    cmd.depthPromptRole = depthPromptRole;
  }
}
/**
 * Parse all character commands from a message and return the cleaned message
 * with commands stripped out.
 */
export function parseCharacterCommands(content: string): {
  cleanContent: string;
  commands: CharacterCommand[];
} {
  const commands: CharacterCommand[] = [];

  // Parse schedule_update commands
  for (const match of content.matchAll(SCHEDULE_UPDATE_RE)) {
    const params = match[1]!;
    const cmd: ScheduleUpdateCommand = { type: "schedule_update" };

    const statusMatch = params.match(/status="([^"]+)"/);
    if (statusMatch) {
      const s = statusMatch[1]!.toLowerCase();
      if (["online", "idle", "dnd", "offline"].includes(s)) {
        cmd.status = s as ScheduleUpdateCommand["status"];
      }
    }

    const activityMatch = params.match(/activity="([^"]+)"/);
    if (activityMatch) cmd.activity = activityMatch[1]!;

    const durationMatch = params.match(/duration="([^"]+)"/);
    if (durationMatch) cmd.duration = durationMatch[1]!;

    commands.push(cmd);
  }

  // Parse cross_post commands
  for (const match of content.matchAll(CROSS_POST_RE)) {
    commands.push({ type: "cross_post", target: match[1]! });
  }

  // Parse selfie commands
  for (const match of content.matchAll(SELFIE_RE)) {
    const context = (match[1] ?? match[2] ?? match[3])?.trim();
    commands.push({ type: "selfie", context: context || undefined });
  }

  // Parse memory commands
  for (const match of content.matchAll(MEMORY_RE)) {
    commands.push({ type: "memory", target: match[1]!, summary: match[2]! });
  }

  for (const match of content.matchAll(BARE_MEMORY_RE)) {
    const command = parseBareMemoryCommand(match[1]!);
    if (command) commands.push(command);
  }

  // Parse scene commands
  for (const match of content.matchAll(SCENE_RE)) {
    const params = match[1]!;
    const cmd: SceneCommand = { type: "scene", scenario: "" };

    cmd.scenario =
      parseSceneTextParam(params, ["scenario", "description", "prompt"]) ?? parseBareSceneScenario(params) ?? "";
    cmd.background = parseSceneTextParam(params, ["background"]);
    cmd.plan = parseSceneTextParam(params, ["plan"]);

    // Only add if we got a scenario
    if (cmd.scenario) commands.push(cmd);
  }

  // Parse influence commands (<influence>text</influence>)
  for (const match of content.matchAll(INFLUENCE_RE)) {
    const text = stripConversationPromptTimestamps(match[1]!.trim());
    if (text) commands.push({ type: "influence", content: text });
  }

  // Parse note commands (<note>text</note>)
  for (const match of content.matchAll(NOTE_RE)) {
    const text = stripConversationPromptTimestamps(match[1]!.trim());
    if (text) commands.push({ type: "note", content: text });
  }

  // Parse Spotify song commands
  for (const match of content.matchAll(SPOTIFY_RE)) {
    const params = match[1]!;
    const title = parseQuotedParam(params, "title");
    const artist = parseQuotedParam(params, "artist");
    if (title && artist) {
      commands.push({ type: "spotify", title, artist });
    }
  }

  // Parse assistant commands (Deki-senpai)
  for (const match of content.matchAll(CREATE_PERSONA_RE)) {
    const params = match[1]!;
    const cmd: CreatePersonaCommand = { type: "create_persona", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    const description = parseQuotedParam(params, "description");
    if (description) cmd.description = description;
    const personality = parseQuotedParam(params, "personality");
    if (personality) cmd.personality = personality;
    const appearance = parseQuotedParam(params, "appearance");
    if (appearance) cmd.appearance = appearance;
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_CHARACTER_RE)) {
    const params = match[1]!;
    const cmd: CreateCharacterCommand = { type: "create_character", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    applyCommonCharacterFields(cmd, params, { allowEmptyStrings: false });
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(UPDATE_CHARACTER_RE)) {
    const params = match[1]!;
    const cmd: UpdateCharacterCommand = { type: "update_character", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    applyCommonCharacterFields(cmd, params, { allowEmptyStrings: true });
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(UPDATE_PERSONA_RE)) {
    const params = match[1]!;
    const cmd: UpdatePersonaCommand = { type: "update_persona", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    const description = parseQuotedParam(params, "description", true);
    if (description !== undefined) cmd.description = description;
    const personality = parseQuotedParam(params, "personality", true);
    if (personality !== undefined) cmd.personality = personality;
    const appearance = parseQuotedParam(params, "appearance", true);
    if (appearance !== undefined) cmd.appearance = appearance;
    const scenario = parseQuotedParam(params, "scenario", true);
    if (scenario !== undefined) cmd.scenario = scenario;
    const backstory = parseQuotedParam(params, "backstory", true);
    if (backstory !== undefined) cmd.backstory = backstory;
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_LOREBOOK_BLOCK_RE)) {
    const cmd = parseLorebookBlock(match[1] ?? "");
    if (cmd) commands.push(cmd);
  }

  for (const match of content.matchAll(UPDATE_LOREBOOK_BLOCK_RE)) {
    const cmd = parseUpdateLorebookBlock(match[1] ?? "");
    if (cmd) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_PRESET_BLOCK_RE)) {
    const cmd = parsePresetBlock(match[1] ?? "");
    if (cmd) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_LOREBOOK_RE)) {
    const params = match[1]!;
    const name = parseQuotedParam(params, "name");
    if (!name) continue;
    const entriesParam = parseQuotedParam(params, "entries");
    commands.push({
      type: "create_lorebook",
      name,
      description: parseQuotedParam(params, "description"),
      category: parseQuotedParam(params, "category"),
      tags: parseStringList(parseQuotedParam(params, "tags")),
      entries: entriesParam ? parseLorebookEntriesParam(entriesParam) : undefined,
    });
  }

  for (const match of content.matchAll(CREATE_CHAT_RE)) {
    const params = match[1]!;
    const cmd: CreateChatCommand = { type: "create_chat", character: "" };
    const charMatch = params.match(/character="([^"]+)"/);
    if (charMatch) cmd.character = charMatch[1]!;
    const modeMatch = params.match(/mode="([^"]+)"/);
    if (modeMatch && (modeMatch[1] === "conversation" || modeMatch[1] === "roleplay")) {
      cmd.mode = modeMatch[1];
    }
    if (cmd.character) commands.push(cmd);
  }

  for (const match of content.matchAll(NAVIGATE_RE)) {
    const params = match[1]!;
    const cmd: NavigateCommand = { type: "navigate", panel: "" };
    const panelMatch = params.match(/panel="([^"]+)"/);
    if (panelMatch) cmd.panel = panelMatch[1]!;
    const tabMatch = params.match(/tab="([^"]+)"/);
    if (tabMatch) cmd.tab = tabMatch[1]!;
    if (cmd.panel) commands.push(cmd);
  }

  for (const match of content.matchAll(FETCH_RE)) {
    const params = match[1]!;
    const cmd: FetchCommand = { type: "fetch", fetchType: "character", name: "" };
    const typeMatch = params.match(/type="([^"]+)"/);
    if (typeMatch) {
      const t = typeMatch[1]!.toLowerCase();
      if (["character", "persona", "lorebook", "chat", "preset"].includes(t)) {
        cmd.fetchType = t as FetchCommand["fetchType"];
      }
    }
    const nameMatch = params.match(/name="([^"]+)"/);
    if (nameMatch) cmd.name = nameMatch[1]!;
    if (cmd.name) commands.push(cmd);
  }

  // Strip all commands from the visible content
  const cleanContent = content
    .replace(SCHEDULE_UPDATE_RE, "")
    .replace(CROSS_POST_RE, "")
    .replace(SELFIE_RE, "")
    .replace(MEMORY_RE, "")
    .replace(BARE_MEMORY_RE, "")
    .replace(SCENE_RE, "")
    .replace(SPOTIFY_RE, "")
    .replace(INFLUENCE_RE, "")
    .replace(NOTE_RE, "")
    .replace(CREATE_PERSONA_RE, "")
    .replace(CREATE_CHARACTER_RE, "")
    .replace(UPDATE_CHARACTER_RE, "")
    .replace(UPDATE_PERSONA_RE, "")
    .replace(CREATE_LOREBOOK_BLOCK_RE, "")
    .replace(UPDATE_LOREBOOK_BLOCK_RE, "")
    .replace(CREATE_PRESET_BLOCK_RE, "")
    .replace(CREATE_LOREBOOK_RE, "")
    .replace(CREATE_CHAT_RE, "")
    .replace(NAVIGATE_RE, "")
    .replace(FETCH_RE, "")
    .replace(/\n{3,}/g, "\n\n") // collapse excessive newlines left by removals
    .trim();

  return { cleanContent, commands };
}

/** Parse Roleplay-only direct-message commands without enabling the wider Conversation command set. */
export function parseDirectMessageCommands(content: string): {
  cleanContent: string;
  commands: DirectMessageCommand[];
  invalidCommands: number;
  invalidCommandRaws: string[];
} {
  const commands: DirectMessageCommand[] = [];
  let invalidCommands = 0;
  const invalidCommandRaws: string[] = [];

  for (const match of content.matchAll(DIRECT_MESSAGE_RE)) {
    const params = match[1]!;
    const character = parseQuotedParam(params, "character");
    const message = parseQuotedParam(params, "message");
    const cleanMessage = message ? stripConversationPromptTimestamps(message.trim()) : "";
    if (character && cleanMessage) {
      commands.push({ type: "dm", character, message: cleanMessage, raw: match[0] });
    } else {
      invalidCommands += 1;
      invalidCommandRaws.push(match[0]);
    }
  }

  const cleanContent = content
    .replace(DIRECT_MESSAGE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanContent, commands, invalidCommands, invalidCommandRaws };
}
