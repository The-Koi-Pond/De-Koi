// GM dialogue lines use speaker tags (`[Pierrot] [main] [scared]: "Run."`). Plain
// text surfaces such as the combat log show them as `Pierrot: "Run."`.
// A speaker tag is a name, a dialogue type slot (main/side/extra/thought/whisper),
// and optional expression tags. Other bracketed labels ("[Quest]: …",
// "[Quest] [faded]: …") are ordinary prose and stay as written.
const SPEAKER_LINE_RE =
  /^([ \t]*)\[([^\]\n]+)\][ \t]*\[(?:main|side|extra|thought|whisper(?::[^\]\n]*)?)\](?:[ \t]*\[[^\]\n]*\])*[ \t]*:[ \t]*/gim;

export function speakerTagsToProse(text: string): string {
  return text.replace(SPEAKER_LINE_RE, (_line, indent: string, speaker: string) => `${indent}${speaker.trim()}: `);
}
