// ──────────────────────────────────────────────
// Voice turn timing: how long the character took to start talking
// ──────────────────────────────────────────────
// Measures one call turn from the moment the user stopped talking to the first sound of the reply's voice, split
// into the stages that add up to that wait, so a slow call can be traced to the stage that is slow.

/** Milliseconds per stage of one turn. A null stage couldn't be measured with this voice input. */
export interface VoiceTurnTiming {
  readonly turn: number;
  /** The user stopped talking (or their words came back, when that moment isn't known) → first sound of the reply. */
  readonly totalMs: number;
  /** The pause waited for to be sure the user had finished. Null with the browser's recognizer, which hides it. */
  readonly endOfSpeechMs: number | null;
  /** End of the recording → its text back from the provider. Null with the browser's recognizer. */
  readonly transcribeMs: number | null;
  /** Text back → message sent. Above zero when a cut-off reply had to finish stopping first. */
  readonly sendMs: number;
  /** Message sent → first words of the reply streamed in (prompt building plus the model's first token). */
  readonly firstWordsMs: number;
  /** First words → first piece complete enough to speak (a sentence or a line). */
  readonly firstSentenceMs: number;
  /** First piece queued → its audio started playing (voice provider, download and decoding). */
  readonly voiceMs: number;
}

/** When the user's words were heard, on the session's clock. */
export interface VoiceHeardMarks {
  /** When the user actually went quiet. Null when the input can't tell. */
  speechEndedAt: number | null;
  /** When the pause was long enough to end the recording. Null when the input can't tell. */
  recordingEndedAt: number | null;
  textAt: number;
}

function span(from: number | null, to: number | null): number | null {
  return from === null || to === null ? null : Math.max(0, Math.round(to - from));
}

/** Follows one turn. Each mark after the first of its kind is ignored. */
export class VoiceTurnTimer {
  private firstWordsAt: number | null = null;
  private firstPieceAt: number | null = null;
  private heldForUser = false;
  private reported = false;

  constructor(
    private readonly turn: number,
    private readonly heard: VoiceHeardMarks | null,
    private readonly sentAt: number,
  ) {}

  firstWords(at: number): void {
    this.firstWordsAt ??= at;
  }

  firstPiece(at: number): void {
    this.firstWords(at);
    this.firstPieceAt ??= at;
  }

  /** The voice was held for the user before it made a sound: the wait is theirs, not the pipeline's. */
  hold(): void {
    if (!this.reported) this.heldForUser = true;
  }

  /**
   * The reply's first sound. Returns the turn's timing the first time, or null when it was already reported or
   * the voice was held for the user before it started.
   */
  firstSound(at: number): VoiceTurnTiming | null {
    if (this.reported) return null;
    this.reported = true;
    if (this.heldForUser) return null;
    const firstPieceAt = this.firstPieceAt ?? at;
    const firstWordsAt = this.firstWordsAt ?? firstPieceAt;
    const textAt = this.heard?.textAt ?? this.sentAt;
    const origin = this.heard?.speechEndedAt ?? textAt;
    return {
      turn: this.turn,
      totalMs: span(origin, at)!,
      endOfSpeechMs: span(this.heard?.speechEndedAt ?? null, this.heard?.recordingEndedAt ?? null),
      transcribeMs: span(this.heard?.recordingEndedAt ?? null, this.heard ? textAt : null),
      sendMs: span(textAt, this.sentAt)!,
      firstWordsMs: span(this.sentAt, firstWordsAt)!,
      firstSentenceMs: span(firstWordsAt, firstPieceAt)!,
      voiceMs: span(firstPieceAt, at)!,
    };
  }
}
