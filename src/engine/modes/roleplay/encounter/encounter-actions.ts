// Who an attack or item can be aimed at, and the action text a choice sends as the player's turn.
import type { EncounterAttack, EncounterFight } from "./encounter-types";

export type EncounterChoice = { type: "attack"; attack: EncounterAttack } | { type: "item"; item: string };

export interface EncounterTargetOption {
  side: "enemy" | "party";
  name: string;
  hp: number;
  maxHp: number;
}

export interface EncounterTargets {
  allEnemies: boolean;
  combatants: EncounterTargetOption[];
}

export function encounterChoiceName(choice: EncounterChoice): string {
  return choice.type === "attack" ? choice.attack.name : choice.item;
}

/** AoE attacks hit all enemies only; "both" adds single targets; everything else picks one living combatant. */
export function encounterTargets(fight: EncounterFight, choice: EncounterChoice): EncounterTargets {
  const attackType = choice.type === "attack" ? choice.attack.type : "single-target";
  const living = [
    ...fight.enemies.map((enemy) => ({ side: "enemy" as const, name: enemy.name, hp: enemy.hp, maxHp: enemy.maxHp })),
    ...fight.party.map((member) => ({ side: "party" as const, name: member.name, hp: member.hp, maxHp: member.maxHp })),
  ].filter((option) => option.hp > 0);
  return {
    allEnemies: attackType !== "single-target",
    combatants: attackType === "AoE" ? [] : living,
  };
}

/** `target` is a combatant's name, or null for all enemies. */
export function encounterActionText(choice: EncounterChoice, target: string | null): string {
  const name = encounterChoiceName(choice);
  return target === null ? `Uses ${name} targeting all enemies!` : `Uses ${name} on ${target}!`;
}
