// "/roll 2d6+1 rest of the turn" rolls real dice instead of asking the GM to invent a result.
const SLASH_ROLL_PATTERN = /^\/roll\s+((?:\d+)?d\d+(?:\s*[+-]\s*\d+)?)(?:\s+([\s\S]*))?$/i;

export function parseSlashRoll(text: string): { notation: string; rest: string } | null {
  const match = SLASH_ROLL_PATTERN.exec(text.trim());
  if (!match) return null;
  return { notation: match[1]!.replace(/\s+/g, "").toLowerCase(), rest: (match[2] ?? "").trim() };
}
