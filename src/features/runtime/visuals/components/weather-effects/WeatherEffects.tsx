// ──────────────────────────────────────────────
// Weather Effects — ambient weather, time-of-day tint and sun/moon behind a roleplay chat
// ──────────────────────────────────────────────
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { startWeatherLoop } from "./weather-loop";
import { describeWeatherScene } from "./weather-scene";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** True while the system asks for reduced motion (spec decision 4); follows the setting live. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => reducedMotionQuery()?.matches ?? false,
    () => false,
  );
}

interface WeatherEffectsProps {
  weather?: string | null;
  timeOfDay?: string | null;
  /** Draw the sun or moon when the time names one. Default true. */
  showCelestial?: boolean;
}

export function WeatherEffects({ weather, timeOfDay, showCelestial = true }: WeatherEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const scene = useMemo(
    () => describeWeatherScene(weather, timeOfDay, showCelestial, reducedMotion),
    [weather, timeOfDay, showCelestial, reducedMotion],
  );

  // Start over when the text changes or the sun/moon appears or disappears. Toggling
  // `showCelestial` when the time names no sun or moon changes nothing, so it doesn't restart;
  // passing `showsBody` as `showCelestial` rebuilds the same scene.
  const showsBody = scene.showsBody;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startWeatherLoop(canvas, describeWeatherScene(weather, timeOfDay, showsBody, reducedMotion));
  }, [weather, timeOfDay, showsBody, reducedMotion]);

  if (!scene.renders) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />;
}
