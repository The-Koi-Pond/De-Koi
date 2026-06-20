import { buildSpriteExpressionChoices } from "../modes/game/prompts/sprite.service";

export type SpriteDisplayMode = "expressions" | "full-body";

export interface AvailableSpriteCharacter {
  characterId: string;
  characterName: string;
  expressions: string[];
  expressionChoices?: string[];
}

export interface SpriteExpressionEntry {
  characterId?: unknown;
  characterName?: unknown;
  expression?: unknown;
  transition?: unknown;
}

export interface SpriteExpressionCompletionOptions {
  defaultSourceText?: string;
  sourceTextByCharacterId?: ReadonlyMap<string, string>;
  personaCharacterIds?: ReadonlySet<string>;
}

interface ExpressionValidationWarning {
  message: string;
}

export interface ExpressionValidationResult<T extends SpriteExpressionEntry> {
  expressions: T[];
  warnings: ExpressionValidationWarning[];
}

const DEFAULT_SPRITE_DISPLAY_MODES: SpriteDisplayMode[] = ["expressions", "full-body"];

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function normalizeSpriteDisplayModes(value: unknown): SpriteDisplayMode[] {
  const rawModes = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const modes: SpriteDisplayMode[] = [];

  for (const mode of rawModes) {
    const normalized = mode === "fullBody" || mode === "full_body" ? "full-body" : mode;
    if (normalized === "expressions" && !modes.includes("expressions")) {
      modes.push("expressions");
    } else if (normalized === "full-body" && !modes.includes("full-body")) {
      modes.push("full-body");
    }
  }

  return modes.length > 0 ? modes : [...DEFAULT_SPRITE_DISPLAY_MODES];
}

export function buildAvailableSpriteCharacter(
  characterId: string,
  characterName: string,
  expressions: string[],
): AvailableSpriteCharacter | null {
  const uniqueExpressions = uniqueStrings(expressions);
  if (uniqueExpressions.length === 0) return null;
  return {
    characterId,
    characterName,
    expressions: uniqueExpressions,
    expressionChoices: buildSpriteExpressionChoices(uniqueExpressions),
  };
}

function normalizeLookupToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeNameAliases(name: string): string[] {
  const aliases = new Set<string>();
  const normalized = normalizeLookupToken(name);
  if (normalized) aliases.add(normalized);

  const withoutCommonTitle = name.replace(/^\s*(il|la|le|the)\s+/i, "");
  const normalizedWithoutTitle = normalizeLookupToken(withoutCommonTitle);
  if (normalizedWithoutTitle) aliases.add(normalizedWithoutTitle);

  return [...aliases];
}

function normalizeExpressionToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function hasUsefulContainmentMatch(candidate: string, option: string): boolean {
  if (candidate.length < 3 || option.length < 3) return false;
  return candidate.includes(option) || option.includes(candidate);
}

function pickRandomExpression(expressions: string[]): string | null {
  if (expressions.length === 0) return null;
  return expressions[Math.floor(Math.random() * expressions.length)] ?? expressions[0] ?? null;
}

function getExpressionPrefixVariant(expression: string, groupKey: string): boolean {
  const lower = expression.toLowerCase();
  const normalizedGroup = groupKey.trim().toLowerCase();
  return lower.startsWith(`${normalizedGroup}_`);
}

function resolveCharacter(
  entry: SpriteExpressionEntry,
  availableSprites: AvailableSpriteCharacter[],
): AvailableSpriteCharacter | null {
  const rawId = typeof entry.characterId === "string" ? entry.characterId.trim() : "";
  if (rawId) {
    const exactId = availableSprites.find((sprite) => sprite.characterId === rawId);
    if (exactId) return exactId;

    const caseInsensitiveId = availableSprites.find(
      (sprite) => sprite.characterId.toLowerCase() === rawId.toLowerCase(),
    );
    if (caseInsensitiveId) return caseInsensitiveId;
  }

  const candidates = [entry.characterName, entry.characterId]
    .map(normalizeLookupToken)
    .filter((candidate) => candidate.length > 0);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const exact = availableSprites.find((sprite) => {
      if (normalizeLookupToken(sprite.characterId) === candidate) return true;
      return normalizeNameAliases(sprite.characterName).includes(candidate);
    });
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const fuzzyName = availableSprites.find((sprite) =>
      normalizeNameAliases(sprite.characterName).some((alias) => hasUsefulContainmentMatch(candidate, alias)),
    );
    if (fuzzyName) return fuzzyName;
  }

  return null;
}

function resolveExpression(expression: string, availableExpressions: string[]): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  const prefixMatches = availableExpressions.filter((entry) => getExpressionPrefixVariant(entry, trimmed));
  const randomPrefixMatch = prefixMatches.length > 1 ? pickRandomExpression(prefixMatches) : null;
  if (randomPrefixMatch) return randomPrefixMatch;

  const exact = availableExpressions.find((entry) => entry.toLowerCase() === lower);
  if (exact) return exact;

  const normalized = normalizeExpressionToken(trimmed);
  const normalizedExact = availableExpressions.find((entry) => normalizeExpressionToken(entry) === normalized);
  if (normalizedExact) return normalizedExact;

  return (
    availableExpressions.find((entry) => {
      const option = normalizeExpressionToken(entry);
      return hasUsefulContainmentMatch(normalized, option);
    }) ?? null
  );
}

function fallbackExpression(expressions: string[]): string | null {
  const normalizedFallbacks = new Set([
    "neutral",
    "default",
    "normal",
    "calm",
    "idle",
    "fullneutral",
    "fulldefault",
    "fullnormal",
    "fullcalm",
    "fullidle",
  ]);
  return (
    expressions.find((entry) => normalizedFallbacks.has(normalizeExpressionToken(entry))) ??
    expressions.find((entry) => /^full[_-]?(?:neutral|default|normal|calm|idle)$/i.test(entry.trim())) ??
    expressions[0] ??
    null
  );
}

function resolveInferredExpression(expression: string, availableExpressions: string[]): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const exact = availableExpressions.find((entry) => entry.toLowerCase() === lower);
  if (exact) return exact;

  const normalized = normalizeExpressionToken(trimmed);
  const normalizedExact = availableExpressions.find((entry) => normalizeExpressionToken(entry) === normalized);
  if (normalizedExact) return normalizedExact;

  return availableExpressions.find((entry) => getExpressionPrefixVariant(entry, trimmed)) ?? null;
}

function splitSourceSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…。！？])\s+|[\r\n]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitSourceClauses(text: string): string[] {
  return text
    .split(/\b(?:while|whilst|whereas|but|though|although|however|meanwhile)\b|[;:]/iu)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function includesCharacterAlias(text: string, character: AvailableSpriteCharacter): boolean {
  const normalizedText = normalizeLookupToken(text);
  if (!normalizedText) return false;
  return normalizeNameAliases(character.characterName).some((alias) => alias && normalizedText.includes(alias));
}

function namedCharacterScopedSourceText(character: AvailableSpriteCharacter, sourceText: string): string | null {
  const text = sourceText.trim();
  if (!text) return null;

  const namedSentence = splitSourceSentences(text).find((sentence) => includesCharacterAlias(sentence, character));
  if (!namedSentence) return null;

  return splitSourceClauses(namedSentence).find((clause) => includesCharacterAlias(clause, character)) ?? namedSentence;
}

function isFirstPersonPersonaClause(text: string): boolean {
  return /\b(?:i|i'm|i'd|i'll|i've|im|my|mine|myself)\b/i.test(text);
}

function personaScopedSourceText(character: AvailableSpriteCharacter, sourceText: string): string {
  const text = sourceText.trim();
  if (!text) return "";

  const firstPersonSentence = splitSourceSentences(text).find(isFirstPersonPersonaClause);
  if (firstPersonSentence) {
    return splitSourceClauses(firstPersonSentence).find(isFirstPersonPersonaClause) ?? firstPersonSentence;
  }

  return namedCharacterScopedSourceText(character, text) ?? "";
}

function characterScopedSourceText(
  character: AvailableSpriteCharacter,
  sourceText: string,
  isPersonaCharacter: boolean,
): string {
  if (isPersonaCharacter) return personaScopedSourceText(character, sourceText);
  return namedCharacterScopedSourceText(character, sourceText) ?? sourceText.trim();
}

function inferExpressionCandidatesFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const candidates: string[] = [];

  const add = (...values: string[]) => {
    for (const value of values) {
      if (!candidates.includes(value)) candidates.push(value);
    }
  };

  if (/\b(blush|blushes|blushing|fluster|flustered|embarrass|embarrassed|shy|bashful)\b/.test(lower)) {
    add("blush", "embarrassed", "shy", "flustered");
  }
  if (/\b(angry|anger|rage|furious|annoyed|irritated|frustrated|glare|glares|scowl|scowls)\b/.test(lower)) {
    add("angry", "annoyed", "irritated");
  }
  if (/\b(sad|cry|cries|crying|tears|sorrow|grief|hurt|heartbroken|melancholy)\b/.test(lower)) {
    add("sad", "crying", "melancholy");
  }
  if (/\b(happy|smile|smiles|smiling|grin|grins|grinning|laugh|laughs|laughing|joy|excited|delighted)\b/.test(lower)) {
    add("happy", "smile", "joy", "excited");
  }
  if (/\b(surprised|surprise|shock|shocked|gasp|startled|stunned)\b/.test(lower)) {
    add("surprised", "shocked", "startled");
  }
  if (/\b(scared|afraid|fear|fearful|terrified|panic|panicked|nervous|anxious)\b/.test(lower)) {
    add("scared", "afraid", "nervous", "anxious");
  }
  if (/\b(disgust|disgusted|gross|repulsed|repulsing)\b/.test(lower)) {
    add("disgusted", "disgust");
  }
  if (/\b(think|thinking|consider|considering|wonder|wondering|hmm|thoughtful|ponder)\b/.test(lower)) {
    add("thinking", "thoughtful", "ponder");
  }

  add("neutral", "default", "normal", "calm", "idle");
  return candidates;
}

function pickFallbackExpression(
  character: AvailableSpriteCharacter,
  sourceText: string,
  isPersonaCharacter: boolean,
): string | null {
  const scopedSourceText = characterScopedSourceText(character, sourceText, isPersonaCharacter);
  if (scopedSourceText) {
    for (const candidate of inferExpressionCandidatesFromText(scopedSourceText)) {
      const resolved = resolveInferredExpression(candidate, character.expressions);
      if (resolved) return resolved;
    }
  }
  return fallbackExpression(character.expressions);
}

function validateSpriteExpressionEntries<T extends SpriteExpressionEntry>(
  expressions: T[] | undefined,
  availableSprites: AvailableSpriteCharacter[] | undefined,
): ExpressionValidationResult<T> {
  const warnings: ExpressionValidationWarning[] = [];
  if (!Array.isArray(expressions) || !Array.isArray(availableSprites)) {
    return { expressions: [], warnings };
  }

  const validated: T[] = [];
  for (const entry of expressions) {
    if (typeof entry.characterId !== "string" && typeof entry.characterName !== "string") {
      warnings.push({ message: "Malformed expression entry without character identity - skipping" });
      continue;
    }
    if (typeof entry.expression !== "string") {
      warnings.push({ message: "Malformed expression entry without expression - skipping" });
      continue;
    }

    const character = resolveCharacter(entry, availableSprites);
    const suppliedIdentity =
      typeof entry.characterId === "string" && entry.characterId.trim()
        ? entry.characterId.trim()
        : typeof entry.characterName === "string" && entry.characterName.trim()
          ? entry.characterName.trim()
          : "unknown";
    if (!character) {
      warnings.push({ message: `Expression agent returned unknown character "${suppliedIdentity}" - removing` });
      continue;
    }

    if (entry.characterId !== character.characterId) {
      warnings.push({
        message: `Expression agent used "${suppliedIdentity}" - resolved to ${character.characterName} (${character.characterId})`,
      });
    }

    const expression = resolveExpression(entry.expression, character.expressions);
    if (!expression) {
      warnings.push({
        message: `Expression agent chose "${entry.expression}" for ${character.characterName} which does not exist - removing`,
      });
      continue;
    }

    if (entry.expression !== expression) {
      warnings.push({
        message: `Expression agent chose "${entry.expression}" - correcting to closest match "${expression}"`,
      });
    }

    entry.characterId = character.characterId;
    entry.characterName = character.characterName;
    entry.expression = expression;
    validated.push(entry);
  }

  return { expressions: validated, warnings };
}

export function completeRequiredSpriteExpressionEntries<T extends SpriteExpressionEntry>(
  expressions: T[] | undefined,
  availableSprites: AvailableSpriteCharacter[] | undefined,
  requiredCharacterIds: readonly unknown[] | undefined,
  options: SpriteExpressionCompletionOptions = {},
): ExpressionValidationResult<SpriteExpressionEntry> {
  const validation = validateSpriteExpressionEntries(expressions, availableSprites);
  if (!Array.isArray(availableSprites) || !Array.isArray(requiredCharacterIds)) {
    return validation;
  }

  const completed: SpriteExpressionEntry[] = [...validation.expressions];
  const seen = new Set(
    completed
      .map((entry) => (typeof entry.characterId === "string" ? entry.characterId.trim() : ""))
      .filter((characterId) => characterId.length > 0),
  );

  for (const rawId of requiredCharacterIds) {
    const characterId = typeof rawId === "string" ? rawId.trim() : "";
    if (!characterId || seen.has(characterId)) continue;
    const character = availableSprites.find((sprite) => sprite.characterId === characterId);
    if (!character) continue;
    const sourceText = options.sourceTextByCharacterId?.get(characterId) ?? options.defaultSourceText ?? "";
    const expression = pickFallbackExpression(
      character,
      sourceText,
      options.personaCharacterIds?.has(characterId) === true,
    );
    if (!expression) continue;
    completed.push({
      characterId: character.characterId,
      characterName: character.characterName,
      expression,
      transition: "crossfade",
    });
    seen.add(character.characterId);
    validation.warnings.push({
      message: `Expression agent omitted ${character.characterName} - filled missing required expression "${expression}"`,
    });
  }

  return { expressions: completed, warnings: validation.warnings };
}
