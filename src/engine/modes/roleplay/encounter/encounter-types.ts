// Shapes for Roleplay combat encounters. A fight lives only in memory: none of these are saved.
// Behavior spec: docs/provenance/roleplay-encounters.md.

export type EncounterCallKind = "setup" | "turn" | "summary";

export type EncounterAttackType = "single-target" | "AoE" | "both";

export type EncounterStatusStat = "attack" | "defense" | "speed" | "hp";

export type EncounterResult = "victory" | "defeat" | "fled" | "interrupted";

export interface EncounterAttack {
  name: string;
  type: EncounterAttackType;
  description?: string;
  power?: number;
  cooldown?: number;
  element?: string;
  statusEffect?: string;
}

export interface EncounterStatus {
  name: string;
  emoji: string;
  duration: number;
  modifier?: number;
  stat?: EncounterStatusStat;
}

export interface EncounterPartyMember {
  name: string;
  hp: number;
  maxHp: number;
  attacks: EncounterAttack[];
  items: string[];
  statuses: EncounterStatus[];
  isPlayer: boolean;
}

export interface EncounterEnemy {
  name: string;
  hp: number;
  maxHp: number;
  attacks: EncounterAttack[];
  statuses: EncounterStatus[];
  description: string;
  sprite: string;
}

export interface EncounterStyleNotes {
  environmentType: string;
  atmosphere: string;
  timeOfDay: string;
  weather: string;
}

export interface EncounterPlayerActions {
  attacks: EncounterAttack[];
  items: string[];
}

export interface EncounterFight {
  party: EncounterPartyMember[];
  enemies: EncounterEnemy[];
  environment: string;
  styleNotes: EncounterStyleNotes;
  playerActions: EncounterPlayerActions;
}

/** One round of the fight record that later turns and the summary read. */
export interface EncounterRound {
  action: string;
  enemyActions: string[];
  partyActions: string[];
  narrative: string;
}

export type EncounterLogKind = "system" | "player" | "enemy" | "ally" | "narration";

export interface EncounterLogLine {
  kind: EncounterLogKind;
  text: string;
}

export interface EncounterNarrationStyle {
  tense: "present" | "past";
  person: "first" | "second" | "third";
  narration: "omniscient" | "limited";
  pov: string;
}

export interface EncounterSettings {
  combatNarration: EncounterNarrationStyle;
  summaryNarration: EncounterNarrationStyle;
  spellbookId: string | null;
  historyDepth: number;
}

export interface EncounterTurnOutcome {
  fight: EncounterFight;
  round: EncounterRound;
  log: EncounterLogLine[];
  /** Set when this turn ended the fight. */
  result: EncounterResult | null;
}
