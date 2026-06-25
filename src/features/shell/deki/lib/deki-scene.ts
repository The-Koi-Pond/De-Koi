export type DekiSceneMood = "idle" | "thinking" | "responding";

export type DekiSceneStateInput = {
  historyLoaded: boolean;
  sending: boolean;
};

export const DEKI_SCENE_POSES: Record<DekiSceneMood, string> = {
  idle: "/koi-mark.svg",
  thinking: "/koi-mark.svg",
  responding: "/koi-mark.svg",
};

export function getDekiSceneMood({ historyLoaded, sending }: DekiSceneStateInput): DekiSceneMood {
  if (!historyLoaded) return "thinking";
  if (sending) return "responding";
  return "idle";
}
