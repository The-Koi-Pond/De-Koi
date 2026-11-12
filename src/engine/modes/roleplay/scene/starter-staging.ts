// ──────────────────────────────────────────────
// Starter staging: how a new Roleplay with a staged character starts
// ──────────────────────────────────────────────
// A character made from a staged starter carries its own sprites and scene backgrounds. The first time a new
// Roleplay with it opens, the chat starts in the character's opening scene and shows its sprites (the Expression
// agent picks them, on the chat's own model). It happens once per chat, only while the chat has nothing but the
// greeting, and every part of it stays an ordinary chat setting the user can change afterwards. A chat whose
// agents were switched off keeps them off.

import { BUILT_IN_AGENT_IDS, chatAgentsEnabled } from "../../../contracts/types/agent";
import { normalizeSceneBackgrounds } from "./scene-backgrounds";

/** Chat metadata key that records the staging was done. */
export const STARTER_STAGING_APPLIED_KEY = "starterStagingApplied";

export interface StagingCharacter {
  id: string;
  /** The card's `extensions` record. */
  extensions: Record<string, unknown> | null | undefined;
}

export interface StarterStagingPatch {
  starterStagingApplied: true;
  background?: string;
  spriteCharacterIds?: string[];
  activeAgentIds?: string[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
}

function hasBackground(metadata: Record<string, unknown>): boolean {
  return typeof metadata.background === "string" && metadata.background.trim().length > 0;
}

/** Whether a card asks for its sprites to be shown when a new Roleplay with it starts. */
export function characterStartsStaged(extensions: Record<string, unknown> | null | undefined): boolean {
  return extensions?.startsStaged === true;
}

/**
 * The chat settings a new Roleplay gets from its staged characters, or null when there is nothing to do: the
 * chat was staged before, already has replies beyond the greeting, or has no staged character.
 */
export function starterStagingPatch(input: {
  metadata: Record<string, unknown>;
  characters: readonly StagingCharacter[];
  /** Assistant and narrator messages in the chat, the greeting included. */
  replyCount: number;
}): StarterStagingPatch | null {
  const { metadata, characters, replyCount } = input;
  if (metadata[STARTER_STAGING_APPLIED_KEY] === true || replyCount > 1) return null;

  const opening = characters
    .map((character) => normalizeSceneBackgrounds(character.extensions?.sceneBackgrounds)[0])
    .find((scene) => scene !== undefined);
  const staged = characters.filter((character) => characterStartsStaged(character.extensions));
  if (!opening && staged.length === 0) return null;

  const patch: StarterStagingPatch = { starterStagingApplied: true };
  if (opening && !hasBackground(metadata)) patch.background = opening.background;

  if (staged.length > 0) {
    const spriteIds = stringList(metadata.spriteCharacterIds);
    const nextSpriteIds = [...spriteIds];
    for (const character of staged) {
      const ownerKey = `character:${character.id}`;
      if (!nextSpriteIds.includes(ownerKey) && !nextSpriteIds.includes(character.id)) nextSpriteIds.push(ownerKey);
    }
    if (nextSpriteIds.length !== spriteIds.length) patch.spriteCharacterIds = nextSpriteIds;

    const agentIds = stringList(metadata.activeAgentIds);
    if (chatAgentsEnabled(metadata) && !agentIds.includes(BUILT_IN_AGENT_IDS.EXPRESSION)) {
      patch.activeAgentIds = [...agentIds, BUILT_IN_AGENT_IDS.EXPRESSION];
    }
  }
  return patch;
}
