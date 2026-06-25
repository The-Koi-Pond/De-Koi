export type DekiSceneMood = "idle" | "thinking" | "responding";

export type DekiSceneStateInput = {
  historyLoaded: boolean;
  sending: boolean;
};

export const DEKI_SCENE_POSES: Record<DekiSceneMood, string> = {
  idle: "/sprites/deki/Deki_greet.png",
  thinking: "/sprites/deki/Deki_thinking.png",
  responding: "/sprites/deki/Deki_explaining.png",
};

export function getDekiSceneMood({ historyLoaded, sending }: DekiSceneStateInput): DekiSceneMood {
  if (!historyLoaded) return "thinking";
  if (sending) return "responding";
  return "idle";
}
