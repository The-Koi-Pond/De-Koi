// GM dialogue lines use speaker tags (`[Pierrot] [main] [scared]: "Run."`). Plain
// text surfaces such as the combat log show them as `Pierrot: "Run."`.
const SPEAKER_LINE_RE = /^([ \t]*)\[([^\]\n]+)\](?:[ \t]*\[[^\]\n]*\])*[ \t]*:[ \t]*/gm;

export function speakerTagsToProse(text: string): string {
  return text.replace(SPEAKER_LINE_RE, (_line, indent: string, speaker: string) => `${indent}${speaker.trim()}: `);
}
