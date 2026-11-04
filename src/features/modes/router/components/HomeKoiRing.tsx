import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { usePageActivity } from "../../../../shared/hooks/use-page-activity";

/*
 * The Pond theme's home hero: Deki inside a ring of three koi, seen from
 * above, each circling at its own pace with a faint wake behind it, while
 * soft ripples spread out from the middle. The koi swim smoothly, and every
 * few seconds (at random, separately) one beats its tail and darts ahead,
 * leaving a small ripple where it kicked off.
 *
 * Purely decorative: everything here is aria-hidden except `children` (Deki
 * and the splash line). Styles live in src/styles/themes/pond.css
 * ("Home: the koi ring"). With reduced motion, or in low-power mode, the koi
 * rest at their starting places and the ripples stand still.
 */

interface KoiColours {
  body: string;
  patch: string;
  fin: string;
}

interface RingKoi {
  colours: KoiColours;
  /** Distance of this koi's circle from the ring's edge, in % of the ring. */
  inset: number;
  /** Seconds per lap. */
  lap: number;
  clockwise: boolean;
  /** Where it starts (and rests when still), in degrees from 12 o'clock. */
  angle: number;
}

// Deki's art colours (BRAND.md, "Colours for drawings"), plus the brand's
// koi vermilion for the kohaku's patches.
const RING_KOI: readonly RingKoi[] = [
  { colours: { body: "#fef6ed", patch: "#f7694a", fin: "#fef6ed" }, inset: 0, lap: 34, clockwise: true, angle: 215 },
  { colours: { body: "#fd9e82", patch: "#fef6ed", fin: "#fed7ca" }, inset: 10.2, lap: 26, clockwise: false, angle: 50 },
  { colours: { body: "#fef6ed", patch: "#a1cdc1", fin: "#a1cdc1" }, inset: 19.5, lap: 20, clockwise: true, angle: 320 },
];

/** Ripples spreading from the middle: start offset (s), and the scale/opacity they hold when still. */
const RIPPLES = [
  { delay: 0, stillScale: 1.6, stillOpacity: 0.35 },
  { delay: -4, stillScale: 2.3, stillOpacity: 0.2 },
  { delay: -8, stillScale: 2.9, stillOpacity: 0.1 },
] as const;

/*
 * The wake: an arc WAKE_DEGREES long right behind the koi (which sits at 12
 * o'clock of its circle), drawn as WAKE_PIECES short arcs that fade with
 * distance. A circle's stroke starts at 3 o'clock and runs clockwise, so with
 * pathLength 360, 12 o'clock is at 270. Counter-clockwise koi get the same
 * wake mirrored (CSS scaleX(--koi-face)).
 */
const WAKE_DEGREES = 110;
const WAKE_PIECES = 8;
const WAKE_ARCS = Array.from({ length: WAKE_PIECES }, (_, piece) => {
  const length = WAKE_DEGREES / WAKE_PIECES;
  const start = 270 - (piece + 1) * length;
  return {
    // A hair longer than the piece, so neighbouring pieces meet without a gap.
    dashArray: `${(length + 0.4).toFixed(2)} ${(360 - length - 0.4).toFixed(2)}`,
    dashOffset: (-start).toFixed(2),
    opacity: (1 - (piece + 0.5) / WAKE_PIECES).toFixed(3),
  };
});

function KoiWake() {
  return (
    <svg className="koi-ring-wake" viewBox="0 0 100 100" aria-hidden="true">
      {WAKE_ARCS.map((arc, piece) => (
        <circle
          key={piece}
          cx="50"
          cy="50"
          r="49.5"
          pathLength={360}
          strokeDasharray={arc.dashArray}
          strokeDashoffset={arc.dashOffset}
          strokeOpacity={arc.opacity}
        />
      ))}
    </svg>
  );
}

const BURST_MS = 1700;
/** How far a burst carries a koi along its circle, in px. */
const BURST_PX = 60;
const FIRST_BURST_MS = [1500, 6500] as const;
const NEXT_BURST_MS = [5000, 13000] as const;

function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function isStill(): boolean {
  const root = document.documentElement;
  if (root.dataset.deKoiShellPerformance === "low") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** One burst: a push ahead along the circle, a few fast tail beats, a brighter wake and a small splash. */
function burstKoi(ring: HTMLElement, index: number): void {
  const orbit = ring.querySelector<HTMLElement>(`[data-koi-orbit="${index}"]`);
  const surge = orbit?.querySelector<HTMLElement>(".koi-ring-surge");
  if (!orbit || !surge || typeof surge.animate !== "function") return;
  // offsetWidth ignores the orbit's own rotation, unlike getBoundingClientRect.
  const radius = orbit.offsetWidth / 2;
  if (!radius) return;

  const from = Number(surge.dataset.offset ?? 0);
  const to = from + Number(orbit.dataset.sign) * (BURST_PX / radius) * (180 / Math.PI);
  surge.dataset.offset = String(to);
  const push = surge.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], {
    duration: BURST_MS,
    easing: "cubic-bezier(.4,0,.2,1)",
    fill: "forwards",
  });
  // Keep the koi where the push left it. Set directly rather than with
  // commitStyles(), which throws if Home was hidden during the push.
  push.onfinish = () => {
    surge.style.transform = `rotate(${to}deg)`;
    push.cancel();
  };
  surge.querySelector(".koi-ring-wake")?.animate([{ opacity: 0.55 }, { opacity: 1, offset: 0.35 }, { opacity: 0.55 }], {
    duration: 2200,
    easing: "ease-out",
  });
  surge.querySelector(".koi-ring-beat")?.animate(
    [0, 26, -26, 22, -16, 8, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
    { duration: 1100, easing: "ease-in-out" },
  );
  surge.querySelector(".koi-ring-fish")?.animate(
    [0, -5, 5, -4, 2, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
    { duration: 1000, easing: "ease-in-out" },
  );

  // A small ripple spreads from where the koi kicked off, under the koi.
  const koi = surge.querySelector(".koi-ring-koi");
  if (!koi) return;
  const ringBox = ring.getBoundingClientRect();
  const koiBox = koi.getBoundingClientRect();
  const splash = document.createElement("div");
  splash.className = "koi-ring-splash";
  splash.setAttribute("aria-hidden", "true");
  splash.style.left = `${koiBox.x + koiBox.width / 2 - ringBox.x}px`;
  splash.style.top = `${koiBox.y + koiBox.height / 2 - ringBox.y}px`;
  ring.insertBefore(splash, ring.querySelector("[data-koi-orbit]"));
  splash.animate(
    [
      { transform: "scale(.6)", opacity: 0.7 },
      { transform: "scale(3.2)", opacity: 0 },
    ],
    { duration: 2000, easing: "cubic-bezier(.2,.6,.4,1)" },
  ).onfinish = () => splash.remove();
}

/** A koi seen from above, facing right, in Deki's style. */
function KoiFromAbove({ colours: { body, patch, fin } }: { colours: KoiColours }) {
  return (
    <svg className="koi-ring-koi" viewBox="-1 -1 38 22">
      <g className="koi-ring-fish">
        <g stroke="#623a2d" strokeWidth="1" strokeLinejoin="round">
          <g className="koi-ring-beat">
            <path
              className="koi-ring-tail"
              d="M10 10 C7 7 4 4.2 1 3.6 C2.8 6.4 3.8 8.4 4.6 10 C3.8 11.6 2.8 13.6 1 16.4 C4 15.8 7 13 10 10 Z"
              fill={fin}
            />
          </g>
          <path d="M26 6.4 C24 2.8 20.6 1.6 18.6 2.1 C20.2 3.6 21.8 5.2 23.2 6.8 Z" fill={fin} />
          <path d="M26 13.6 C24 17.2 20.6 18.4 18.6 17.9 C20.2 16.4 21.8 14.8 23.2 13.2 Z" fill={fin} />
          <path d="M15.5 7.2 C14 5.4 12 4.8 11 5.2 C12 6.2 13 7.2 14 7.9 Z" fill={fin} />
          <path d="M15.5 12.8 C14 14.6 12 15.2 11 14.8 C12 13.8 13 12.8 14 12.1 Z" fill={fin} />
          <path
            d="M35 10 C35 6.6 31.4 5 26 5.2 C19 5.5 13 7.6 9 10 C13 12.4 19 14.5 26 14.8 C31.4 15 35 13.4 35 10 Z"
            fill={body}
          />
        </g>
        <path d="M27 6 C30.5 6.2 32 7.8 31.6 9.6 C29.6 9 27.8 8.8 26 9.6 C25.4 8.2 25.8 6.8 27 6 Z" fill={patch} />
        <path d="M14 9.2 C17 8.2 20.5 8.4 22.6 10.2 C20.6 12.4 17 12.6 14.4 11.2 Z" fill={patch} />
        <circle cx="32" cy="7.6" r=".95" fill="#2b1a14" />
        <circle cx="32" cy="12.4" r=".95" fill="#2b1a14" />
      </g>
    </svg>
  );
}

export function HomeKoiRing({ children }: { children: ReactNode }) {
  const ringRef = useRef<HTMLDivElement>(null);
  const isPageActive = usePageActivity();

  useEffect(() => {
    const ring = ringRef.current;
    if (!isPageActive || !ring) return;
    const timers: number[] = [];
    const schedule = (index: number, wait: number) => {
      timers[index] = window.setTimeout(() => {
        if (!isStill()) burstKoi(ring, index);
        schedule(index, randomBetween(NEXT_BURST_MS));
      }, wait);
    };
    RING_KOI.forEach((_, index) => schedule(index, randomBetween(FIRST_BURST_MS)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [isPageActive]);

  return (
    <div ref={ringRef} className="koi-ring">
      {RIPPLES.map((ripple, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="koi-ring-ripple"
          style={
            {
              "--ripple-delay": `${ripple.delay}s`,
              "--ripple-still-scale": ripple.stillScale,
              "--ripple-still-opacity": ripple.stillOpacity,
            } as CSSProperties
          }
        />
      ))}
      {RING_KOI.map((koi, index) => {
        // A negative delay starts the lap part-way round, so each koi begins at its own angle.
        const delay = -(((koi.clockwise ? koi.angle : 360 - koi.angle) / 360) * koi.lap);
        return (
          <div
            key={index}
            aria-hidden="true"
            className="koi-ring-orbit"
            data-koi-orbit={index}
            data-sign={koi.clockwise ? 1 : -1}
            style={
              {
                "--orbit-inset": `${koi.inset}%`,
                "--orbit-lap": `${koi.lap}s`,
                "--orbit-delay": `${delay.toFixed(2)}s`,
                "--orbit-direction": koi.clockwise ? "normal" : "reverse",
                "--koi-face": koi.clockwise ? 1 : -1,
                "--orbit-still": `${koi.angle}deg`,
              } as CSSProperties
            }
          >
            <div className="koi-ring-surge">
              <KoiWake />
              <KoiFromAbove colours={koi.colours} />
            </div>
          </div>
        );
      })}
      {children}
    </div>
  );
}
