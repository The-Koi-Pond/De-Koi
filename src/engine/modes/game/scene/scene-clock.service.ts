import type { SceneAnalysis } from "../../../contracts/types/scene";

export interface SceneClockUpdate {
  timeOfDay: string | null;
  elapsedMinutes: number | null;
  shouldAdvanceTimeOfDay: boolean;
}

function hasElapsedMinutesEstimate(value: SceneAnalysis["elapsedMinutes"]): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function resolveSceneClockUpdate(
  scene: Pick<SceneAnalysis, "timeOfDay" | "elapsedMinutes">,
): SceneClockUpdate {
  const elapsedMinutes = hasElapsedMinutesEstimate(scene.elapsedMinutes) ? scene.elapsedMinutes : null;
  const timeOfDay = scene.timeOfDay || null;

  return {
    timeOfDay,
    elapsedMinutes,
    shouldAdvanceTimeOfDay: timeOfDay !== null && elapsedMinutes === null,
  };
}
