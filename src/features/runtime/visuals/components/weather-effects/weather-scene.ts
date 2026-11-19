// ──────────────────────────────────────────────
// Weather effects: turn the tracker's weather and time text into a scene
// ──────────────────────────────────────────────

export type WeatherParticleType =
  "rain" | "snow" | "leaf" | "petal" | "fog" | "dust" | "ember" | "ash" | "sand" | "hail" | "aurora";

export type ParticleType = WeatherParticleType | "firefly" | "star";

export type CelestialBody = "sun" | "moon" | "none";

interface WeatherReading {
  type: WeatherParticleType;
  count: number;
  overlay: string | null;
  lightning: boolean;
}

interface TimeReading {
  tint: string | null;
  fireflies: boolean;
  stars: boolean;
  body: CelestialBody;
  /** 0–23, or -1 when the text names no hour. */
  hour: number;
  sunRays: boolean;
  sunsetGlow: boolean;
}

export interface WeatherScene extends WeatherReading, TimeReading {
  clearSky: boolean;
  /** The sun or moon is drawn (still only under a clear sky). */
  showsBody: boolean;
  /** The canvas exists at all. */
  renders: boolean;
  /** Frames keep coming; otherwise the scene is drawn once per start or resize. */
  animates: boolean;
}

const containsAny = (text: string, words: readonly string[]) => words.some((word) => text.includes(word));

interface WeatherRule {
  words: readonly string[];
  read: (text: string) => WeatherReading;
}

const fixed =
  (type: WeatherParticleType, count: number, overlay: string | null): WeatherRule["read"] =>
  () => ({ type, count, overlay, lightning: false });

// First matching row wins, so order matters (for example "sandstorm" is caught by the rain row).
const WEATHER_RULES: readonly WeatherRule[] = [
  {
    words: ["thunder", "lightning"],
    read: () => ({ type: "rain", count: 200, overlay: "rgba(50,80,120,0.10)", lightning: true }),
  },
  {
    words: ["rain", "storm", "downpour"],
    read: (text) => {
      const heavy = containsAny(text, ["heavy", "storm", "downpour"]);
      return {
        type: "rain",
        count: heavy ? 200 : 80,
        overlay: "rgba(50,80,120,0.08)",
        lightning: heavy && text.includes("storm"),
      };
    },
  },
  { words: ["hail"], read: fixed("hail", 60, "rgba(180,200,230,0.06)") },
  { words: ["blizzard"], read: fixed("snow", 150, "rgba(200,220,255,0.10)") },
  {
    words: ["snow", "sleet"],
    read: (text) => fixed("snow", text.includes("heavy") ? 120 : 50, "rgba(200,220,255,0.06)")(text),
  },
  { words: ["frost", "cold", "freez"], read: fixed("snow", 15, "rgba(180,210,240,0.06)") },
  { words: ["fog", "mist", "haze"], read: fixed("fog", 20, "rgba(180,180,200,0.12)") },
  { words: ["sand", "dust storm", "sirocco"], read: fixed("sand", 100, "rgba(180,150,100,0.12)") },
  { words: ["ash", "volcanic", "smoke"], read: fixed("ash", 40, "rgba(80,60,60,0.10)") },
  { words: ["ember", "fire", "inferno"], read: fixed("ember", 35, "rgba(120,40,10,0.08)") },
  { words: ["wind", "breez", "gust"], read: fixed("leaf", 25, null) },
  { words: ["cherry", "blossom", "petal"], read: fixed("petal", 30, "rgba(255,180,200,0.04)") },
  { words: ["aurora", "northern light", "polar light"], read: fixed("aurora", 6, "rgba(20,60,40,0.08)") },
  { words: ["clear", "sunny", "bright"], read: fixed("dust", 12, null) },
  { words: ["cloud", "overcast", "grey", "gray"], read: fixed("dust", 8, "rgba(100,100,120,0.05)") },
];

function readWeather(weather: string | null | undefined): WeatherReading {
  if (!weather) return { type: "dust", count: 0, overlay: null, lightning: false };
  const text = weather.toLowerCase();
  const rule = WEATHER_RULES.find((candidate) => containsAny(text, candidate.words));
  return rule ? rule.read(text) : { type: "dust", count: 10, overlay: null, lightning: false };
}

const CLEAR_WORDS = /clear|sunny|bright/i;
const CLOUDED_WORDS = /(rain|storm|snow|blizzard|fog|mist|haze|hail|sand|ash|smoke|overcast|cloud|grey|gray)/i;

function isClearSky(weather: string | null | undefined): boolean {
  if (!weather) return true;
  return CLEAR_WORDS.test(weather) || !CLOUDED_WORDS.test(weather);
}

const inHourRange = (hour: number) => hour >= 0 && hour <= 23;

/** The hour named in lower-cased time text, or -1. */
function findHour(text: string): number {
  const clock = /\b(\d{1,2})[:.h](\d{2})\b/.exec(text);
  if (clock) {
    let hour = Number(clock[1]);
    if (text.includes("pm") && hour < 12) hour += 12;
    if (text.includes("am") && hour === 12) hour = 0;
    if (inHourRange(hour)) return hour;
  }

  const meridiem = /\b(\d{1,2})\s*(am|pm)\b/.exec(text);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    if (meridiem[2] === "pm" && hour < 12) hour += 12;
    if (meridiem[2] === "am" && hour === 12) hour = 0;
    if (inHourRange(hour)) return hour;
  }

  const military = /\b(\d{4})\s*(?:hours?|hrs?)?\b/.exec(text);
  if (military) {
    const hour = Number(military[1].slice(0, 2));
    if (inHourRange(hour)) return hour;
  }

  return -1;
}

const NIGHT_TINT = "rgba(10,10,40,0.15)";
const DUSK_TINT = "rgba(80,30,20,0.10)";
const DAWN_TINT = "rgba(120,80,40,0.06)";

function nightTime(type: WeatherParticleType, hour: number): TimeReading {
  return {
    tint: NIGHT_TINT,
    fireflies: type !== "rain" && type !== "snow",
    stars: type !== "fog" && type !== "snow",
    body: "moon",
    hour,
    sunRays: false,
    sunsetGlow: false,
  };
}

function duskTime(type: WeatherParticleType, hour: number): TimeReading {
  return {
    tint: DUSK_TINT,
    fireflies: type !== "rain",
    stars: false,
    body: "sun",
    hour,
    sunRays: false,
    sunsetGlow: true,
  };
}

function dayTime(tint: string | null, hour: number): TimeReading {
  return { tint, fireflies: false, stars: false, body: "sun", hour, sunRays: true, sunsetGlow: false };
}

function readTimeOfDay(timeOfDay: string | null | undefined, type: WeatherParticleType): TimeReading {
  const none: TimeReading = {
    tint: null,
    fireflies: false,
    stars: false,
    body: "none",
    hour: -1,
    sunRays: false,
    sunsetGlow: false,
  };
  if (!timeOfDay) return none;

  const text = timeOfDay.toLowerCase();
  const hour = findHour(text);
  const found = hour >= 0;
  const orDefault = (fallback: number) => (found ? hour : fallback);

  if (containsAny(text, ["night", "midnight"])) return nightTime(type, orDefault(0));
  if (containsAny(text, ["dusk", "sunset", "twilight", "evening"])) return duskTime(type, orDefault(18));
  if (containsAny(text, ["dawn", "sunrise", "morning"])) return dayTime(DAWN_TINT, orDefault(7));
  if (found) {
    if (hour >= 21 || hour <= 4) return nightTime(type, hour);
    if (hour >= 17) return duskTime(type, hour);
    if (hour <= 8) return dayTime(DAWN_TINT, hour);
    return dayTime(null, hour);
  }
  if (containsAny(text, ["noon", "midday", "afternoon", "day"])) {
    return dayTime(null, text.includes("afternoon") ? 15 : 12);
  }
  return none;
}

export function describeWeatherScene(
  weather: string | null | undefined,
  timeOfDay: string | null | undefined,
  showCelestial: boolean,
): WeatherScene {
  const weatherReading = readWeather(weather);
  const time = readTimeOfDay(timeOfDay, weatherReading.type);
  const clearSky = isClearSky(weather);
  const showsBody = showCelestial && time.body !== "none";
  const hasParticles = weatherReading.count > 0 || time.fireflies || time.stars;

  return {
    ...weatherReading,
    ...time,
    clearSky,
    showsBody,
    renders: hasParticles || showsBody || time.sunsetGlow || clearSky,
    animates: hasParticles || weatherReading.lightning || (showsBody && clearSky && time.sunRays),
  };
}
