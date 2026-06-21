const NAME_STOPWORDS = new Set(["the", "a", "an", "il", "la", "le", "de", "van", "von", "dr", "mr", "ms"]);

function readString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function normalizeIllustrationReferenceName(value: unknown): string {
  return readString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function illustrationReferenceNameAliases(name: unknown): string[] {
  const rawName = readString(name);
  const normalized = normalizeIllustrationReferenceName(rawName);
  if (!normalized) return [];

  const aliases = new Set<string>([normalized]);
  const withoutParenthetical = normalizeIllustrationReferenceName(rawName.replace(/\([^)]*\)/g, " "));
  if (withoutParenthetical) aliases.add(withoutParenthetical);

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 1) {
    const withoutLeadingTitle = tokens.filter((token, index) => index > 0 || !NAME_STOPWORDS.has(token)).join(" ");
    if (withoutLeadingTitle) aliases.add(withoutLeadingTitle);
  }

  for (const token of tokens) {
    if (token.length >= 3 && !NAME_STOPWORDS.has(token)) aliases.add(token);
  }

  return [...aliases].sort((a, b) => b.length - a.length);
}

function illustrationTextContainsAlias(normalizedText: string, alias: string): boolean {
  if (!normalizedText || !alias) return false;
  return new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(normalizedText);
}

export function illustrationSubjectMatches(
  subject: { name?: unknown },
  item: { requestedNames?: unknown; prompt?: unknown },
): boolean {
  const aliases = illustrationReferenceNameAliases(subject.name);
  if (aliases.length === 0) return false;

  const requestedNames = stringArray(item.requestedNames).map(normalizeIllustrationReferenceName).filter(Boolean);
  if (requestedNames.length > 0) {
    return requestedNames.some((requestedName) =>
      aliases.some(
        (alias) =>
          alias === requestedName ||
          illustrationTextContainsAlias(requestedName, alias) ||
          illustrationTextContainsAlias(alias, requestedName),
      ),
    );
  }

  const prompt = normalizeIllustrationReferenceName(item.prompt);
  return aliases.some((alias) => illustrationTextContainsAlias(prompt, alias));
}
