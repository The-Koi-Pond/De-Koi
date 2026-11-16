import { useId, type CSSProperties, type ReactNode } from "react";

/*
 * The Pond theme's lotus divider ("Trail", chosen 2026-11-04; DESIGN.md
 * section 7): a flame-shaped white bulb warming to soft yellow at its tip,
 * lotus-pink wing petals and deeper back petals that fade to near-white on the
 * side facing the bulb, and jade leaves whose tips run into the divider's
 * fading lines. The gaps between parts are real holes (masks), so it sits right
 * on any surface. Colours and lines: src/styles/themes/pond.css ("The lotus
 * divider").
 *
 * Drawn in a 120 x 60 box; the leaf tips are at y = 52.3.
 */

const HEART =
  "M60 6C61.5 11 65 15 67.5 19.5C71 25.5 70 32.5 65.5 37.5C63.4 39.8 61.4 41.6 60 44C58.6 41.6 56.6 39.8 54.5 37.5C50 32.5 49 25.5 52.5 19.5C55 15 58.5 11 60 6Z";
/** A back petal pointing up from its base at (0, 0): 35 long, 11 wide. */
const BACK_PETAL = "M0 0C10.45 -7.7 8.8 -23.8 0 -35C-8.8 -23.8 -10.45 -7.7 0 0Z";
const BACK_PETAL_PLACE = "translate(53 43.5) rotate(-31)";
const WING = "M60 47.4C50 47.9 38 47.4 28 44.4C18 41.4 10 35.4 2.5 25.5C12 30 22 31.4 32 31.9C44 32.5 53 37.2 60 47.4Z";
const LEAF = "M57.4 52.4C48 49.2 36 48.8 24 50.3C16 51.3 8 51.9 0 52.3C9 55.2 22 56.8 34 55.8C44 55 51 54.2 57.4 52.4Z";
const MIRROR = "translate(120 0) scale(-1 1)";
const LEAF_TIP_Y = 52.3;
/** Width of the gap cut around each part, in drawing units. */
const GAP = 2.2;

function Pair({ d, transform }: { d: string; transform?: string }) {
  return (
    <>
      <path d={d} transform={transform} />
      <g transform={MIRROR}>
        <path d={d} transform={transform} />
      </g>
    </>
  );
}

/** A drawing of the lotus, `width` px wide (height is half of it). */
function LotusMark({ width }: { width: number }) {
  const id = useId().replace(/:/g, "");
  const cut = (children: ReactNode) => (
    <g fill="black" stroke="black" strokeWidth={GAP} strokeLinejoin="round">
      {children}
    </g>
  );
  const heart = <path d={HEART} />;
  const wings = <Pair d={WING} />;
  const maskBox = { maskUnits: "userSpaceOnUse" as const, x: -10, y: -10, width: 140, height: 80 };
  const white = <rect x={-10} y={-10} width={140} height={80} fill="white" />;

  return (
    <svg className="lotus-mark" width={width} height={width / 2} viewBox="0 0 120 60" aria-hidden="true">
      <defs>
        <mask id={`${id}-wing`} {...maskBox}>
          {white}
          {cut(heart)}
        </mask>
        <mask id={`${id}-back`} {...maskBox}>
          {white}
          {cut(
            <>
              {heart}
              {wings}
            </>,
          )}
        </mask>
        {/* The bulb: white, warming to yellow over its upper half. */}
        <linearGradient id={`${id}-bulb`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" className="lotus-stop-bulb" />
          <stop offset="0.5" className="lotus-stop-bulb" />
          <stop offset="1" className="lotus-stop-bulb-tip" />
        </linearGradient>
        {/* Petals: light on the side facing the bulb. Drawn for the left
            petal; the mirrored copy mirrors the fade with it. */}
        <linearGradient id={`${id}-wing-fade`} x1="1" y1="0.9" x2="0.3" y2="0.3">
          <stop offset="0" className="lotus-stop-wing-in" />
          <stop offset="0.6" className="lotus-stop-wing-out" />
        </linearGradient>
        <linearGradient id={`${id}-back-fade`} x1="0.9" y1="0.95" x2="0.1" y2="0.2">
          <stop offset="0" className="lotus-stop-back-in" />
          <stop offset="0.65" className="lotus-stop-back-out" />
        </linearGradient>
      </defs>
      <g mask={`url(#${id}-back)`} fill={`url(#${id}-back-fade)`}>
        <Pair d={BACK_PETAL} transform={BACK_PETAL_PLACE} />
      </g>
      <g mask={`url(#${id}-back)`} className="lotus-leaf">
        <Pair d={LEAF} />
      </g>
      <g mask={`url(#${id}-wing)`} fill={`url(#${id}-wing-fade)`}>
        {wings}
      </g>
      <g className="lotus-bulb" fill={`url(#${id}-bulb)`}>
        {heart}
      </g>
    </svg>
  );
}

/** A divider: fading lines that run into the lotus's leaf tips. */
export function LotusDivider({ width = 40, className }: { width?: number; className?: string }) {
  const lineLift = ((width / 2) * (60 - LEAF_TIP_Y)) / 60;
  return (
    <div
      role="separator"
      className={className ? `lotus-divider ${className}` : "lotus-divider"}
      style={{ "--lotus-line-lift": `${lineLift.toFixed(2)}px` } as CSSProperties}
    >
      <LotusMark width={width} />
    </div>
  );
}
