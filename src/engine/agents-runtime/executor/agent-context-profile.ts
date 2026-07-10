import { BUILT_IN_AGENT_IDS } from "../../contracts/types/agent";

export type AgentLoreField =
  | "description"
  | "personality"
  | "backstory"
  | "appearance"
  | "scenario"
  | "firstMes"
  | "mesExample"
  | "creatorNotes"
  | "systemPrompt"
  | "postHistoryInstructions"
  | "personaStats"
  | "rpgStats";

type BuiltInAgentId = (typeof BUILT_IN_AGENT_IDS)[keyof typeof BUILT_IN_AGENT_IDS];

const FULL_IDENTITY_FIELDS = [
  "description",
  "personality",
  "backstory",
  "appearance",
  "scenario",
  "firstMes",
  "mesExample",
  "creatorNotes",
  "systemPrompt",
  "postHistoryInstructions",
  "personaStats",
  "rpgStats",
] as const satisfies readonly AgentLoreField[];

const NARRATIVE_FIELDS = [
  "description",
  "personality",
  "backstory",
  "scenario",
  "systemPrompt",
  "postHistoryInstructions",
] as const satisfies readonly AgentLoreField[];

const VISUAL_FIELDS = ["description", "appearance", "scenario"] as const satisfies readonly AgentLoreField[];
const MUSIC_FIELDS = ["description", "personality", "scenario"] as const satisfies readonly AgentLoreField[];
const DESCRIPTION_FIELDS = ["description"] as const satisfies readonly AgentLoreField[];
const CHARACTER_STATE_FIELDS = ["description", "appearance", "rpgStats"] as const satisfies readonly AgentLoreField[];
const PERSONA_STATE_FIELDS = ["description", "personaStats"] as const satisfies readonly AgentLoreField[];
const COMBAT_STATE_FIELDS = ["description", "rpgStats"] as const satisfies readonly AgentLoreField[];
const NO_LORE_FIELDS = [] as const satisfies readonly AgentLoreField[];

const BUILT_IN_AGENT_LORE_FIELDS = {
  "world-state": DESCRIPTION_FIELDS,
  "prose-guardian": NARRATIVE_FIELDS,
  continuity: NARRATIVE_FIELDS,
  expression: VISUAL_FIELDS,
  "echo-chamber": NARRATIVE_FIELDS,
  director: NARRATIVE_FIELDS,
  quest: DESCRIPTION_FIELDS,
  illustrator: VISUAL_FIELDS,
  "lorebook-keeper": NARRATIVE_FIELDS,
  "card-evolution-auditor": FULL_IDENTITY_FIELDS,
  "prompt-reviewer": FULL_IDENTITY_FIELDS,
  combat: COMBAT_STATE_FIELDS,
  background: VISUAL_FIELDS,
  "character-tracker": CHARACTER_STATE_FIELDS,
  "persona-stats": PERSONA_STATE_FIELDS,
  html: NO_LORE_FIELDS,
  "chat-summary": NO_LORE_FIELDS,
  "music-dj": MUSIC_FIELDS,
  spotify: MUSIC_FIELDS,
  editor: FULL_IDENTITY_FIELDS,
  "knowledge-retrieval": NARRATIVE_FIELDS,
  "knowledge-router": NARRATIVE_FIELDS,
  "schedule-planner": MUSIC_FIELDS,
  "response-orchestrator": MUSIC_FIELDS,
  "autonomous-messenger": MUSIC_FIELDS,
  "custom-tracker": DESCRIPTION_FIELDS,
  cyoa: NARRATIVE_FIELDS,
  "secret-plot-driver": FULL_IDENTITY_FIELDS,
} as const satisfies Record<BuiltInAgentId, readonly AgentLoreField[]>;

export function loreFieldsForAgentTypes(agentTypes: readonly string[]): ReadonlySet<AgentLoreField> {
  const fields = new Set<AgentLoreField>();

  for (const agentType of agentTypes) {
    const profile = BUILT_IN_AGENT_LORE_FIELDS[agentType as BuiltInAgentId] ?? FULL_IDENTITY_FIELDS;
    for (const field of profile) fields.add(field);
  }

  return fields;
}
