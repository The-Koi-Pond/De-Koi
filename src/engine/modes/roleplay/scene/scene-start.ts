// Starting a scene from either way in (the /scene command or a character's [scene: …] tag): plan, create with the
// opening left to the Roleplay writer, and hand back the opening guide for that first reply.
import { createRoleplayScene } from "./scene-create";
import { buildRoleplaySceneOpeningGuide } from "./scene-opening";
import { planRoleplayScene } from "./scene-planning";
import type { CreatedScene, SceneCapabilities, SceneFullPlan } from "./scene-types";

export interface StartSceneInput {
  originChatId: string;
  request: string;
  /** The character whose reply started the scene, or null for /scene. */
  initiatorCharId: string | null;
  /** Used for planning and as the scene's connection; null keeps the origin's. */
  connectionId: string | null;
}

export interface StartedScene {
  scene: CreatedScene;
  plan: SceneFullPlan;
  /** The narrator guide the scene's opening reply is generated with. */
  openingGenerationGuide: string;
}

/** The planning request a `[scene: …]` tag makes: scenario, plan, then the background as a setting hint. */
export function sceneRequestFromTag(tag: { scenario: string; plan?: string; background?: string }): string {
  const background = tag.background?.trim();
  return [tag.scenario.trim(), tag.plan?.trim() ?? "", background ? `Setting hint: ${background}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

/** Plans and creates a scene. `onPlanned` runs between the two steps (the /scene toast uses it). */
export async function startRoleplayScene(
  capabilities: SceneCapabilities,
  input: StartSceneInput,
  options: { onPlanned?: (plan: SceneFullPlan) => void } = {},
): Promise<StartedScene> {
  const plan = await planRoleplayScene(capabilities, {
    chatId: input.originChatId,
    request: input.request,
    connectionId: input.connectionId,
  });
  options.onPlanned?.(plan);
  const scene = await createRoleplayScene(capabilities.storage, {
    originChatId: input.originChatId,
    plan,
    initiatorCharId: input.initiatorCharId,
    connectionId: input.connectionId,
    openingMode: "generated",
  });
  return { scene, plan, openingGenerationGuide: buildRoleplaySceneOpeningGuide(plan.firstMessage) };
}
