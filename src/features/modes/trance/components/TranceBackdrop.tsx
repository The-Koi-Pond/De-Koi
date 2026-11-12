import "../../../../styles/globals/09-trance-backdrop.css";
import { useMemo, type CSSProperties } from "react";
import type { TranceBackdrop as TranceBackdropKind } from "../../../../shared/stores/ui/model";
import {
  mixHex as mix,
  TRANCE_PALETTES as PALETTES,
  type TranceCharacterShade,
  type TrancePalette,
} from "../lib/trance-colors";

/** Where the session is, for colour: going down, deep, coming up (with how far), drifting off, or a way out. */
export type TranceShade =
  { kind: "down" } | { kind: "deep" } | { kind: "wake"; progress: number } | { kind: "sleep" } | { kind: "exit" };

type Palette = TrancePalette;

/**
 * The colours for where the session is. `guide` (the character's own palettes) replaces the going-down, deep,
 * sleep and wake colours; the ways out always keep their calm colours.
 */
export function trancePalette(shade: TranceShade, guide?: Record<TranceCharacterShade, Palette> | null): Palette {
  const palettes = guide ? { ...PALETTES, ...guide } : PALETTES;
  if (shade.kind !== "wake") return palettes[shade.kind];
  const { deep, awake } = palettes;
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
export function TranceBackdrop({
  kind,
  shade,
  guide = null,
}: {
  kind: TranceBackdropKind;
  shade: TranceShade;
  guide?: Record<TranceCharacterShade, Palette> | null;
}) {
  const palette = trancePalette(shade, guide);
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
