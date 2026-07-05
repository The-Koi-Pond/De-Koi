export interface SpeakerIdentity {
  id?: string;
  color?: string | null;
  names: Array<string | null | undefined>;
}

export function normalizeSpeakerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function speakerIdentityEntries(identities: SpeakerIdentity[]): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const identity of identities) {
    const color = typeof identity.color === "string" ? identity.color.trim() : "";
    if (!color) continue;

    for (const rawName of identity.names) {
      const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
      const key = name ? normalizeSpeakerName(name) : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push([name, color]);
    }
  }

  return entries;
}
