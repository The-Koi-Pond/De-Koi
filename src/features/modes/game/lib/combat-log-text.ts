// GM dialogue lines use speaker tags (`[Pierrot] [main] [scared]: "Run."`). Plain
// text surfaces such as the combat log show them as `Pierrot: "Run."`.
// A speaker tag is a name followed by at least one type/expression tag; a single
// bracketed label such as "[Quest]: Find the key" is ordinary prose.
const SPEAKER_LINE_RE = /^([ \t]*)\[([^\]\n]+)\](?:[ \t]*\[[^\]\n]*\])+[ \t]*:[ \t]*/gm;

export function speakerTagsToProse(text: string): string {
  return text.replace(SPEAKER_LINE_RE, (_line, indent: string, speaker: string) => `${indent}${speaker.trim()}: `);
}
