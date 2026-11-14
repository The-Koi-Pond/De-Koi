import { describe, expect, it } from "vitest";
import { ambienceGain } from "../hooks/use-trance-ambience";
import { pickTranceSoundscape, tranceSoundscapeFor } from "./trance-ambience";

const script = (...texts: string[]) => ({ lines: texts.map((text) => ({ phase: "induction" as const, text })) });

describe("picking a trance soundscape from the session", () => {
  it("follows what the session talks about", () => {
    expect(pickTranceSoundscape(script("Listen to the rain.", "Each raindrop slows you down."))).toBe("rain");
    expect(pickTranceSoundscape(script("The tide comes in.", "Out on the shore, the sea is calm."))).toBe("ocean");
    expect(pickTranceSoundscape(script("A breeze through the trees.", "The wind carries you."))).toBe("wind");
    expect(pickTranceSoundscape(script("A bell rings far off.", "The chimes fade."))).toBe("chimes");
  });

  it("falls back to soft synth when nothing stands out", () => {
    expect(pickTranceSoundscape(script("Breathe in.", "Breathe out.", "One rainy afternoon."))).toBe("pad");
    // "Waves of calm" is hypnosis talk, not the sea: it takes four of them to count.
    expect(pickTranceSoundscape(script("Waves of calm.", "Another wave of calm."))).toBe("pad");
    expect(pickTranceSoundscape(script("Waves.", "A wave.", "More waves.", "Wave after"))).toBe("ocean");
  });

  it("doesn't count words that only contain a sound's name", () => {
    expect(pickTranceSoundscape(script("A rainbow.", "Rainbows everywhere.", "Brainstorm.", "Windows."))).toBe("pad");
  });

  it("uses a fixed choice as is, and plays nothing when off", () => {
    const rainy = script("Rain.", "Rain.");
    expect(tranceSoundscapeFor("chimes", rainy)).toBe("chimes");
    expect(tranceSoundscapeFor("auto", rainy)).toBe("rain");
    expect(tranceSoundscapeFor("off", rainy)).toBeNull();
  });

  it("keeps the slider's loudness gentle and in range", () => {
    expect(ambienceGain(0)).toBe(0);
    expect(ambienceGain(0.5)).toBeCloseTo(0.15);
    expect(ambienceGain(1)).toBeCloseTo(0.6);
    expect(ambienceGain(7)).toBeCloseTo(0.6);
  });
});
