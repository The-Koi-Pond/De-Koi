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
