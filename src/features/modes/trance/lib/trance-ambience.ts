// ──────────────────────────────────────────────
// Trance ambience: soundscapes made on the device with Web Audio (no files, no provider, no credits)
// ──────────────────────────────────────────────
import type { TranceScript } from "../../../../engine/contracts/types/trance";
import type { TranceAmbience, TranceSoundscape } from "../../../../shared/stores/ui/model";

export const SOUNDSCAPE_NAMES: Record<TranceSoundscape, string> = {
  rain: "Rain",
  ocean: "Waves",
  wind: "Wind",
  chimes: "Chimes",
  pad: "Soft synth",
  binaural: "Binaural",
};

// What a session's words have to mention for "Picked for you" to choose a sound. Hypnosis talks about "waves of
// calm" a lot, so waves alone count for less than the sea itself.
const SOUNDSCAPE_WORDS: { kind: TranceSoundscape; pattern: RegExp; weight: number }[] = [
  {
    kind: "rain",
    pattern: /\b(?:rain|rainfall|raindrops?|rainy|drizzle|downpour|storm|thunder|puddles?)\b/gi,
    weight: 1,
  },
  { kind: "ocean", pattern: /\b(?:sea|ocean|tide|shore|beach|surf|seaside)\b/gi, weight: 1 },
  { kind: "ocean", pattern: /\bwaves?\b/gi, weight: 0.5 },
  { kind: "wind", pattern: /\b(?:wind|winds|breeze|gusts?|windy)\b/gi, weight: 1 },
  { kind: "chimes", pattern: /\b(?:bells?|chimes?|chiming)\b/gi, weight: 1 },
];
const PICK_THRESHOLD = 2;

/** The sound that fits the session's own words best; a soft synth when nothing stands out. */
export function pickTranceSoundscape(script: Pick<TranceScript, "lines">): TranceSoundscape {
  const text = script.lines.map((line) => line.text).join("\n");
  const scores = new Map<TranceSoundscape, number>();
  for (const { kind, pattern, weight } of SOUNDSCAPE_WORDS) {
    const hits = text.match(pattern)?.length ?? 0;
    scores.set(kind, (scores.get(kind) ?? 0) + hits * weight);
  }
  let best: TranceSoundscape = "pad";
  let bestScore = PICK_THRESHOLD - Number.EPSILON;
  for (const [kind, score] of scores) {
    if (score > bestScore) {
      best = kind;
      bestScore = score;
    }
  }
  return best;
}

/** The sound a session plays for the chosen setting, or null for none. */
export function tranceSoundscapeFor(
  ambience: TranceAmbience,
  script: Pick<TranceScript, "lines">,
): TranceSoundscape | null {
  if (ambience === "off") return null;
  return ambience === "auto" ? pickTranceSoundscape(script) : ambience;
}

/** One soundscape playing into `out`. */
export interface Soundscape {
  /** Schedules everything that should start before `until` (seconds on the context's clock). */
  fill(until: number): void;
  /** Stops every sound it started. */
  stop(): void;
}

type Random = () => number;

const NOISE_SECONDS = 8;
/** Blended across the loop point so a looping noise bed has no click. */
const NOISE_SEAM_SECONDS = 0.5;

/** Stereo noise that loops without a seam. Pink and brown are normalised to the same loudness as white. */
function noiseBuffer(context: BaseAudioContext, color: "white" | "pink" | "brown", random: Random): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.round(NOISE_SECONDS * rate);
  const seam = Math.round(NOISE_SEAM_SECONDS * rate);
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const raw = new Float32Array(length + seam);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let brown = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const white = random() * 2 - 1;
      if (color === "white") raw[index] = white;
      else if (color === "pink") {
        // Paul Kellet's economy pink filter.
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        raw[index] = b0 + b1 + b2 + white * 0.1848;
      } else {
        brown = (brown + 0.02 * white) / 1.02;
        raw[index] = brown;
      }
    }
    // The extra tail fades into the start, so the end of the loop flows into its beginning.
    for (let index = 0; index < seam; index += 1) {
      const mix = index / seam;
      raw[index] = raw[index]! * mix + raw[length + index]! * (1 - mix);
    }
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += raw[index]! * raw[index]!;
    const scale = 0.25 / Math.max(Math.sqrt(sum / length), 1e-6);
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) data[index] = raw[index]! * scale;
  }
  return buffer;
}

interface Kit {
  context: BaseAudioContext;
  random: Random;
  /** Every source started, so stop() can end them. */
  sources: Set<AudioScheduledSourceNode>;
  noise(color: "white" | "pink" | "brown"): AudioBuffer;
  between(low: number, high: number): number;
  track<T extends AudioScheduledSourceNode>(source: T): T;
  /** A looping noise bed starting at `at`, not yet connected to anything. */
  loop(buffer: AudioBuffer, at: number): AudioBufferSourceNode;
  filter(type: BiquadFilterType, frequency: number, q?: number): BiquadFilterNode;
  gain(value: number): GainNode;
  pan(value: number): StereoPannerNode;
}

function makeKit(context: BaseAudioContext, random: Random): Kit {
  const buffers = new Map<string, AudioBuffer>();
  const sources = new Set<AudioScheduledSourceNode>();
  const kit: Kit = {
    context,
    random,
    sources,
    noise(color) {
      let buffer = buffers.get(color);
      if (!buffer) {
        buffer = noiseBuffer(context, color, random);
        buffers.set(color, buffer);
      }
      return buffer;
    },
    between: (low, high) => low + random() * (high - low),
    track(source) {
      sources.add(source);
      source.addEventListener("ended", () => {
        sources.delete(source);
        source.disconnect();
      });
      return source;
    },
    loop(buffer, at) {
      const source = kit.track(context.createBufferSource());
      source.buffer = buffer;
      source.loop = true;
      // Each bed starts somewhere different in the buffer, so layers made from the same noise don't line up.
      source.start(at, random() * buffer.duration);
      return source;
    },
    filter(type, frequency, q = 0.7) {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      return node;
    },
    gain(value) {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    },
    pan(value) {
      const node = context.createStereoPanner();
      node.pan.value = value;
      return node;
    },
  };
  return kit;
}

function stopAll(sources: Set<AudioScheduledSourceNode>) {
  for (const source of sources) {
    try {
      source.stop();
    } catch (error) {
      // Only a source that never started throws here; it has nothing left to stop.
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
    }
    source.disconnect();
  }
  sources.clear();
}

/** Steady rain on a roof, with drops landing here and there. */
function rain(kit: Kit, out: AudioNode, at: number): Soundscape {
  const { context, between } = kit;
  kit
    .loop(kit.noise("pink"), at)
    .connect(kit.filter("highpass", 500))
    .connect(kit.filter("lowpass", 6500))
    .connect(kit.gain(0.5))
    .connect(out);
  kit.loop(kit.noise("brown"), at).connect(kit.filter("lowpass", 380)).connect(kit.gain(0.45)).connect(out);
  const white = kit.noise("white");
  let nextDrop = at + 0.2;
  return {
    fill(until) {
      while (nextDrop < until) {
        const drop = kit.track(context.createBufferSource());
        drop.buffer = white;
        const tone = kit.filter("bandpass", between(1800, 6000), between(3, 7));
        const level = kit.gain(0);
        const peak = between(0.04, 0.22);
        const decay = between(0.025, 0.07);
        level.gain.setValueAtTime(0, nextDrop);
        level.gain.linearRampToValueAtTime(peak, nextDrop + 0.002);
        level.gain.exponentialRampToValueAtTime(0.0001, nextDrop + decay * 4);
        drop
          .connect(tone)
          .connect(level)
          .connect(kit.pan(between(-0.85, 0.85)))
          .connect(out);
        drop.start(nextDrop, between(0, white.duration - 0.5), decay * 4 + 0.01);
        nextDrop += between(0.03, 0.16);
      }
    },
    stop: () => stopAll(kit.sources),
  };
}

const TROUGH = 0.2;

/** Waves rolling in and drawing back. */
function ocean(kit: Kit, out: AudioNode, at: number): Soundscape {
  const { between } = kit;
  const swell = kit.gain(TROUGH);
  const tone = kit.filter("lowpass", 400);
  kit.loop(kit.noise("brown"), at).connect(tone).connect(swell).connect(out);
  const foam = kit.gain(0.03);
  kit.loop(kit.noise("pink"), at).connect(kit.filter("highpass", 1400)).connect(foam).connect(out);
  let nextWave = at;
  return {
    fill(until) {
      while (nextWave < until) {
        const length = between(7, 12);
        const crest = nextWave + length * between(0.35, 0.45);
        const height = between(0.75, 1);
        // Each wave draws back almost to the trough (three time constants) before the next one starts from it.
        swell.gain.setValueAtTime(TROUGH, nextWave);
        swell.gain.linearRampToValueAtTime(height, crest);
        swell.gain.setTargetAtTime(TROUGH, crest, length * 0.2);
        tone.frequency.setValueAtTime(400, nextWave);
        tone.frequency.linearRampToValueAtTime(between(1000, 1500), crest);
        tone.frequency.setTargetAtTime(400, crest, length * 0.2);
        foam.gain.setValueAtTime(0.03, nextWave);
        foam.gain.linearRampToValueAtTime(0.22 * height, crest + 0.4);
        foam.gain.setTargetAtTime(0.03, crest + 0.4, length * 0.15);
        nextWave += length;
      }
    },
    stop: () => stopAll(kit.sources),
  };
}

/** Wind rising and falling, a little different in each ear. */
function wind(kit: Kit, out: AudioNode, at: number): Soundscape {
  const { between } = kit;
  const layers = [-0.6, 0.6].map((side) => {
    const tone = kit.filter("bandpass", 500, 1.1);
    const level = kit.gain(0.4);
    kit.loop(kit.noise("brown"), at).connect(tone).connect(level).connect(kit.pan(side)).connect(out);
    // Where each gust ends, so the next one starts from there (an AudioParam's .value is now, not then).
    return { tone, level, next: at, frequency: 500, loudness: 0.4 };
  });
  return {
    fill(until) {
      for (const layer of layers) {
        while (layer.next < until) {
          const length = between(4, 9);
          layer.tone.frequency.setValueAtTime(layer.frequency, layer.next);
          layer.frequency = between(260, 950);
          layer.tone.frequency.linearRampToValueAtTime(layer.frequency, layer.next + length);
          layer.level.gain.setValueAtTime(layer.loudness, layer.next);
          layer.loudness = between(0.35, 1.3);
          layer.level.gain.linearRampToValueAtTime(layer.loudness, layer.next + length);
          layer.next += length;
        }
      }
    },
    stop: () => stopAll(kit.sources),
  };
}

// D major pentatonic, two octaves up: any notes together sound sweet.
const CHIME_NOTES = [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1318.51, 1479.98, 1760];
// A struck metal tube: the fundamental plus two inharmonic overtones that die away sooner.
const CHIME_PARTIALS = [
  { ratio: 1, level: 1, decay: 4.5 },
  { ratio: 2.76, level: 0.3, decay: 2 },
  { ratio: 5.4, level: 0.12, decay: 0.9 },
];

/** Wind chimes now and then over a quiet hush of air. */
function chimes(kit: Kit, out: AudioNode, at: number): Soundscape {
  const { context, between } = kit;
  kit.loop(kit.noise("pink"), at).connect(kit.filter("lowpass", 900)).connect(kit.gain(0.18)).connect(out);
  let nextStrike = at + 0.8;
  const strike = (time: number) => {
    const note = CHIME_NOTES[Math.floor(kit.random() * CHIME_NOTES.length)]!;
    const panner = kit.pan(between(-0.7, 0.7));
    panner.connect(out);
    const velocity = between(0.35, 1);
    for (const partial of CHIME_PARTIALS) {
      const tone = kit.track(context.createOscillator());
      tone.frequency.value = note * partial.ratio;
      const level = kit.gain(0);
      level.gain.setValueAtTime(0, time);
      level.gain.linearRampToValueAtTime(0.4 * partial.level * velocity, time + 0.004);
      level.gain.exponentialRampToValueAtTime(0.0001, time + partial.decay);
      tone.connect(level).connect(panner);
      tone.start(time);
      tone.stop(time + partial.decay + 0.05);
    }
  };
  return {
    fill(until) {
      while (nextStrike < until) {
        // Sometimes one chime, sometimes a little cluster as a gust passes.
        const count = kit.random() < 0.6 ? 1 : 2 + Math.floor(kit.random() * 3);
        let time = nextStrike;
        for (let index = 0; index < count; index += 1) {
          strike(time);
          time += between(0.12, 0.45);
        }
        nextStrike = time + between(1.8, 6.5);
      }
    },
    stop: () => stopAll(kit.sources),
  };
}

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
// C add9, A minor 7, F major 7, G sus: slow, warm, never resolving hard.
const PAD_CHORDS = [
  [48, 55, 62, 64],
  [45, 52, 60, 67],
  [41, 48, 57, 64],
  [43, 50, 55, 62],
];
const PAD_CHORD_SECONDS = 14;
const PAD_FADE_SECONDS = 6;

/** Slow, warm synth chords that melt into one another. */
function pad(kit: Kit, out: AudioNode, at: number): Soundscape {
  const { context, between } = kit;
  const warmth = kit.filter("lowpass", 900, 0.5);
  warmth.connect(out);
  let nextChord = at;
  let chordIndex = 0;
  return {
    fill(until) {
      while (nextChord < until) {
        const notes = PAD_CHORDS[chordIndex % PAD_CHORDS.length]!;
        const end = nextChord + PAD_CHORD_SECONDS + PAD_FADE_SECONDS;
        for (const note of notes) {
          const level = kit.gain(0);
          level.gain.setValueAtTime(0, nextChord);
          level.gain.linearRampToValueAtTime(0.09, nextChord + PAD_FADE_SECONDS);
          level.gain.setValueAtTime(0.09, nextChord + PAD_CHORD_SECONDS);
          level.gain.linearRampToValueAtTime(0, end);
          level.connect(kit.pan(between(-0.5, 0.5))).connect(warmth);
          // Two slightly detuned voices per note: the slow beating between them is what makes it breathe.
          for (const [shape, detune] of [
            ["sine", between(-4, -2)],
            ["triangle", between(2, 4)],
          ] as const) {
            const voice = kit.track(context.createOscillator());
            voice.type = shape;
            voice.frequency.value = midi(note);
            voice.detune.value = detune;
            voice.connect(level);
            voice.start(nextChord);
            voice.stop(end + 0.05);
          }
        }
        chordIndex += 1;
        nextChord += PAD_CHORD_SECONDS;
      }
    },
    stop: () => stopAll(kit.sources),
  };
}

/** Binaural beat: 200 Hz in the left ear, 206 Hz in the right, heard as a slow 6 Hz pulse on headphones. */
function binaural(kit: Kit, out: AudioNode, at: number): Soundscape {
  const { context } = kit;
  const merger = context.createChannelMerger(2);
  [200, 206].forEach((frequency, channel) => {
    const tone = kit.track(context.createOscillator());
    tone.frequency.value = frequency;
    const level = kit.gain(0.16);
    tone.connect(level).connect(merger, 0, channel);
    tone.start(at);
  });
  merger.connect(out);
  kit.loop(kit.noise("pink"), at).connect(kit.filter("lowpass", 700)).connect(kit.gain(0.12)).connect(out);
  return { fill() {}, stop: () => stopAll(kit.sources) };
}

const BUILDERS: Record<TranceSoundscape, (kit: Kit, out: AudioNode, at: number) => Soundscape> = {
  rain,
  ocean,
  wind,
  chimes,
  pad,
  binaural,
};

/** Starts `kind` at `at` on the context's clock, playing into `out`. Call fill() ahead of time to keep it going. */
export function startSoundscape(
  context: BaseAudioContext,
  kind: TranceSoundscape,
  out: AudioNode,
  at = context.currentTime,
  random: Random = Math.random,
): Soundscape {
  return BUILDERS[kind](makeKit(context, random), out, at);
}
