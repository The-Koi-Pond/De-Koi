export type DekiSceneMood = "idle" | "thinking" | "responding";

export type DekiSceneStateInput = {
  historyLoaded: boolean;
  sending: boolean;
};

export const DEKI_SCENE_POSES: Record<DekiSceneMood, string> = {
  idle: "/deki-pond-koi.svg",
  thinking: "/deki-pond-koi.svg",
  responding: "/deki-pond-koi.svg",
};

export function getDekiSceneMood({ historyLoaded, sending }: DekiSceneStateInput): DekiSceneMood {
  if (!historyLoaded) return "thinking";
  if (sending) return "responding";
  return "idle";
}
