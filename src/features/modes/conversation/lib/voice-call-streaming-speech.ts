// ──────────────────────────────────────────────
// Voice calls: speak a reply while it is still streaming
// ──────────────────────────────────────────────
// A call used to wait for the whole reply to be saved and then voice all of it, so every turn sat in silence for
// the model's full reply time plus the voice provider's full synthesis time. This speaks each finished piece (a
// line, or a sentence) as soon as it has streamed: its audio is requested right away and pieces play in order.

/**
 * Where the complete text in `text` ends: just past the last line break, or the last sentence end (. ! ? …
 * followed by whitespace), at or after `from`. With `first`, the first such break instead, so the opening piece is
 * short and its audio comes back quickly. Breaks inside [tags], <tags> or {effects} don't count. Returns `from`
 * when there is no complete piece yet.
 */
export function completeSpeechEnd(text: string, from: number, first = false): number {
  let depth = 0;
  let end = from;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "[" || char === "<" || char === "{") depth += 1;
    else if ((char === "]" || char === ">" || char === "}") && depth > 0) depth -= 1;
    if (depth > 0) continue;
    if (char === "\n") {
      end = index + 1;
    } else if (/[.!?…]/.test(char)) {
      // Closing quotes, asterisks or brackets may sit between the punctuation and the space.
      let after = index + 1;
      while (after < text.length && /["'”’)*_~]/.test(text[after]!)) after += 1;
      if (after < text.length && /\s/.test(text[after]!)) end = after + 1;
    }
    if (first && end > from && text.slice(from, end).trim()) return end;
  }
  return end;
}

/** Collapses whitespace and drops markup the voice never reads, so streamed and saved text can be compared. */
function comparable(text: string): string {
  return text
    .replace(/\[[a-z_]+:[^\]]*\]/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface StreamingSpeakerDeps<Request> {
  /** Turns a piece of reply text into voice requests (empty when it has nothing to say). */
  toRequests: (text: string, pieceIndex: number) => Request[];
  /** Starts fetching a request's audio now, so it is ready when its turn to play comes. */
  prefetch: (request: Request) => void;
  /** Plays requests in order; resolves when they finish or are stopped. */
  play: (requests: Request[]) => Promise<void>;
  signal: AbortSignal;
  /**
   * How many pieces after the one playing get their audio fetched ahead of time (default: all of them). Pieces past
   * that wait their turn, so a reply that is cut off doesn't leave a pile of audio requests running.
   */
  prefetchAhead?: number;
}

export class StreamingSpeaker<Request> {
  private consumed = 0;
  private latest = "";
  private pieces = 0;
  private playing: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  /** Pieces with something to say, in order. */
  private queue: Request[][] = [];
  private playingIndex = -1;
  private prefetchedThrough = -1;
  private paused = false;
  private resumeWaiters: Array<() => void> = [];

  constructor(private readonly deps: StreamingSpeakerDeps<Request>) {}

  /** True once any piece has been queued to speak. */
  get started(): boolean {
    return this.pieces > 0;
  }

  /** Feed the reply text streamed so far. Speaks whatever pieces it completes. */
  push(text: string): void {
    if (this.deps.signal.aborted || !text) return;
    // The stream only ever grows; a rewrite (cleared or replaced buffer) can't be followed piece by piece.
    if (!text.startsWith(this.latest.slice(0, this.consumed))) return;
    this.latest = text;
    const end = completeSpeechEnd(text, this.consumed, this.pieces === 0);
    if (end <= this.consumed) return;
    this.say(text.slice(this.consumed, end));
    this.consumed = end;
  }

  /** Holds the next piece back until `resume()` (the piece already playing is paused by whoever plays it). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Speak what is left once the reply is saved, then wait until everything queued has been said. */
  async finish(savedText: string | null): Promise<void> {
    if (!this.deps.signal.aborted) {
      const remainder = this.remainder(savedText);
      if (remainder.trim()) this.say(remainder);
    }
    await this.playing;
    if (this.failure) throw this.failure;
  }

  private remainder(savedText: string | null): string {
    if (this.consumed === 0) return savedText ?? this.latest;
    if (savedText === null) return this.latest.slice(this.consumed);
    const spoken = this.latest.slice(0, this.consumed);
    if (savedText.startsWith(spoken)) return savedText.slice(this.consumed);
    // The saved reply was tidied (tags removed, spacing changed): match on the words instead.
    const spokenWords = comparable(spoken);
    const savedWords = comparable(savedText);
    if (savedWords.startsWith(spokenWords)) return savedWords.slice(spokenWords.length);
    // Saved text no longer begins with what was already said; finish with what streamed rather than repeat it.
    return this.latest.slice(this.consumed);
  }

  private say(text: string): void {
    const requests = this.deps.toRequests(text, this.pieces);
    this.pieces += 1;
    if (!requests.length) return;
    const index = this.queue.push(requests) - 1;
    this.prefetchUpcoming();
    this.playing = this.playing.then(async () => {
      if (this.deps.signal.aborted || this.failure) return;
      if (this.paused) {
        await this.whilePaused();
        if (this.deps.signal.aborted || this.failure) return;
      }
      this.playingIndex = index;
      this.prefetchUpcoming();
      try {
        await this.deps.play(requests);
      } catch (error) {
        this.failure = error;
      }
    });
  }

  private prefetchUpcoming(): void {
    if (this.deps.signal.aborted) return;
    const ahead = this.deps.prefetchAhead;
    const last =
      ahead === undefined ? this.queue.length - 1 : Math.min(this.queue.length - 1, this.playingIndex + ahead);
    while (this.prefetchedThrough < last) {
      this.prefetchedThrough += 1;
      for (const request of this.queue[this.prefetchedThrough]!) this.deps.prefetch(request);
    }
  }

  private whilePaused(): Promise<void> {
    if (this.deps.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      this.resumeWaiters.push(resolve);
      this.deps.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}
