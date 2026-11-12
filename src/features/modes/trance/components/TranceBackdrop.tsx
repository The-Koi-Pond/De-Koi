import "../../../../styles/globals/09-trance-backdrop.css";
import { useMemo, type CSSProperties } from "react";
import type { TranceBackdrop as TranceBackdropKind } from "../../../../shared/stores/ui/model";

/** Where the session is, for colour: going down, deep, coming up (with how far), drifting off, or a way out. */
export type TranceShade =
  { kind: "down" } | { kind: "deep" } | { kind: "wake"; progress: number } | { kind: "sleep" } | { kind: "exit" };

type Palette = { bg: string; a: string; b: string; c: string };

const PALETTES: Record<"down" | "deep" | "sleep" | "exit" | "awake", Palette> = {
  down: { bg: "#0d0b1a", a: "#6d4bd8", b: "#2a7f8f", c: "#8a3f7a" },
  deep: { bg: "#07061a", a: "#4a33a8", b: "#1d5866", c: "#5e2b56" },
  sleep: { bg: "#030308", a: "#2b2160", b: "#10303a", c: "#2e1530" },
  exit: { bg: "#0e1320", a: "#4f6f9f", b: "#3a7a7a", c: "#6a6a9a" },
  awake: { bg: "#1c2236", a: "#9d8cff", b: "#5fc4c4", c: "#d48ab8" },
};

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Mixes two #rrggbb colours; `t` 0 is `from`, 1 is `to`. */
function mix(from: string, to: string, t: number): string {
  const amount = Math.max(0, Math.min(1, t));
  const parts = [0, 1, 2].map((index) =>
    Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
}

export function trancePalette(shade: TranceShade): Palette {
  if (shade.kind !== "wake") return PALETTES[shade.kind];
  const { deep, awake } = PALETTES;
  return {
    bg: mix(deep.bg, awake.bg, shade.progress),
    a: mix(deep.a, awake.a, shade.progress),
    b: mix(deep.b, awake.b, shade.progress),
    c: mix(deep.c, awake.c, shade.progress),
  };
}

/** An Archimedean spiral: `turns` turns from the centre of a 200 x 200 box. */
function spiralPath(turns: number): string {
  const steps = turns * 72;
  const points: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / 72) * Math.PI * 2;
    const radius = (step / steps) * 100;
    points.push(`${(100 + radius * Math.cos(angle)).toFixed(2)} ${(100 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(" L")}`;
}

/** The moving layer behind a trance session's lines. */
export function TranceBackdrop({ kind, shade }: { kind: TranceBackdropKind; shade: TranceShade }) {
  const palette = trancePalette(shade);
  const style = {
    "--trance-bg": palette.bg,
    "--trance-a": palette.a,
    "--trance-b": palette.b,
    "--trance-c": palette.c,
  } as CSSProperties;
  const spiral = useMemo(() => (kind === "spiral" ? spiralPath(7) : ""), [kind]);
  return (
    <div className="trance-backdrop" style={style} data-backdrop={kind} aria-hidden="true">
      {kind === "drift" && (
        <>
          <div className="trance-drift-cloud" />
          <div className="trance-drift-cloud" />
          <div className="trance-drift-cloud" />
        </>
      )}
      {kind === "breathe" && <div className="trance-breathe-glow" />}
      {kind === "spiral" && (
        <svg className="trance-spiral" viewBox="0 0 200 200">
          <path d={spiral} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
