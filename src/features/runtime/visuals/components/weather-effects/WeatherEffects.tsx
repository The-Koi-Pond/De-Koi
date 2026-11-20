// ──────────────────────────────────────────────
// Weather Effects — ambient weather, time-of-day tint and sun/moon behind a roleplay chat
// ──────────────────────────────────────────────
import { useEffect, useMemo, useRef } from "react";
import { startWeatherLoop } from "./weather-loop";
import { describeWeatherScene } from "./weather-scene";

interface WeatherEffectsProps {
  weather?: string | null;
  timeOfDay?: string | null;
  /** Draw the sun or moon when the time names one. Default true. */
  showCelestial?: boolean;
}

export function WeatherEffects({ weather, timeOfDay, showCelestial = true }: WeatherEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(
    () => describeWeatherScene(weather, timeOfDay, showCelestial),
    [weather, timeOfDay, showCelestial],
  );

  // Start over when the text changes or the sun/moon appears or disappears. Toggling
  // `showCelestial` when the time names no sun or moon changes nothing, so it doesn't restart;
  // passing `showsBody` as `showCelestial` rebuilds the same scene.
  const showsBody = scene.showsBody;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startWeatherLoop(canvas, describeWeatherScene(weather, timeOfDay, showsBody));
  }, [weather, timeOfDay, showsBody]);

  if (!scene.renders) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />;
}
