// ──────────────────────────────────────────────
// A chat as a plain transcript, for helpers that turn one mode's chat into another
// ──────────────────────────────────────────────
import { parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";

export interface TranscriptLine {
  role: string;
  name: string;
  content: string;
  /** A hidden note (a scene summary), not something anyone said. */
  note: boolean;
}

export interface TranscriptNames {
  /** Character names by card id. */
  characters: Map<string, string>;
  /** The one character's name when the chat has exactly one, for replies with no character id. */
  only: string | null;
  persona: string;
}

/** The chat's messages in order, each with who said it. Hidden notes (scene summaries) stay in, marked as notes. */
export function chatTranscriptLines(messages: readonly JsonRecord[], names: TranscriptNames): TranscriptLine[] {
  return [...messages]
    .filter((message) => ["user", "assistant", "narrator"].includes(readString(message.role)))
    .filter((message) => readString(message.content).trim())
    .sort((a, b) => readString(a.createdAt).localeCompare(readString(b.createdAt)))
    .map((message) => {
      const role = readString(message.role);
      const name =
        role === "user"
          ? names.persona
          : role === "narrator"
            ? "Narrator"
            : (names.characters.get(readString(message.characterId)) ?? names.only ?? "Character");
      const extra = parseRecord(message.extra);
      return { role, name, content: readString(message.content).trim(), note: extra.hiddenFromUser === true };
    });
}

/** The newest lines that fit in `maxChars`, oldest first, and how many earlier ones were left out. */
export function fitTranscript(lines: readonly TranscriptLine[], maxChars: number): { text: string; left: number } {
  const kept: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const text = line.note ? `(Story note) ${line.content}` : `${line.name}: ${line.content}`;
    if (used + text.length > maxChars && kept.length > 0) return { text: kept.join("\n\n"), left: index + 1 };
    kept.unshift(text);
    used += text.length + 2;
  }
  return { text: kept.join("\n\n"), left: 0 };
}

/**
 * A trance session (`metadata.trance`) as transcript lines, so it can be carried on or retold like a chat: what the
 * session was, how the listener felt going in, the script in the guide's voice (one line per part), and what they said
 * after their latest run. Empty until a script is written.
 */
export function tranceSessionLines(metadata: unknown, names: { guide: string; listener: string }): TranscriptLine[] {
  const trance = parseRecord(parseRecord(metadata).trance);
  const request = parseRecord(trance.request);
  const script = Array.isArray(parseRecord(trance.script).lines) ? (parseRecord(trance.script).lines as unknown[]) : [];
  const parts: Array<{ phase: string; text: string[] }> = [];
  for (const raw of script) {
    const line = parseRecord(raw);
    const text = readString(line.text).trim();
    if (!text) continue;
    const phase = readString(line.phase);
    if (parts.at(-1)?.phase === phase) parts.at(-1)!.text.push(text);
    else parts.push({ phase, text: [text] });
  }
  if (parts.length === 0) return [];
  const say = (role: string, name: string, content: string): TranscriptLine => ({ role, name, content, note: false });
  const pitch = parseRecord(request.pitch);
  const about = [readString(pitch.title).trim(), readString(pitch.summary).trim() || readString(request.idea).trim()]
    .filter(Boolean)
    .join(": ");
  const moods = Array.isArray(request.moods) ? request.moods.map((mood) => readString(mood)).filter(Boolean) : [];
  const felt = [moods.join(", "), readString(request.moodNote).trim()].filter(Boolean).join(". ");
  const run = parseRecord(Array.isArray(trance.runs) ? trance.runs[0] : null);
  const rating = typeof run.rating === "number" ? `felt ${run.rating}/10` : "";
  const after = [
    run.finishedBy === "completed" ? "finished the session" : run.finishedBy ? "left the session early" : "",
    rating,
    run.fullyAwake === false ? "wasn't fully awake at first" : "",
    readString(run.note).trim() ? `said: ${readString(run.note).trim()}` : "",
  ].filter(Boolean);
  return [
    ...(about ? [say("narrator", "The session", about)] : []),
    ...(felt ? [say("user", names.listener, `(Before the session, how I feel) ${felt}`)] : []),
    ...parts.map((part) => say("assistant", `${names.guide} (${part.phase})`, part.text.join(" "))),
    ...(after.length > 0 ? [say("user", names.listener, `(After the session) I ${after.join("; ")}.`)] : []),
  ];
}
