import { getSpriteOwnerId, getSpriteOwnerKind, makeSpriteOwnerKey, type SpriteOwnerKind } from "./sprite-owner-keys";

interface SpriteImage {
  expression: string;
  url: string;
}

/**
 * The sprite to show for `expression`: an exact match, then a close one ("happy" for "happy_2"), then the neutral
 * one, then any sprite at all. Pools are searched in order at each step (expressions before full-body poses, whose
 * `full_` prefix is ignored). Null only when every pool is empty.
 */
export function spriteUrlForExpression(
  pools: ReadonlyArray<readonly SpriteImage[]>,
  expression: string,
): string | null {
  const wanted = expression.toLowerCase();
  const base = (value: string) => (value.startsWith("full_") ? value.slice(5) : value);
  const find = (matches: (spriteExpression: string, baseExpression: string) => boolean) => {
    for (const pool of pools) {
      const match = pool.find((sprite) => {
        const spriteExpression = sprite.expression.toLowerCase();
        return matches(spriteExpression, base(spriteExpression));
      });
      if (match) return match.url;
    }
    return null;
  };
  return (
    find((spriteExpression, baseExpression) => spriteExpression === wanted || baseExpression === wanted) ??
    find(
      (spriteExpression, baseExpression) =>
        spriteExpression.includes(wanted) ||
        wanted.includes(spriteExpression) ||
        baseExpression.includes(wanted) ||
        wanted.includes(baseExpression),
    ) ??
    find(
      (_, baseExpression) => baseExpression === "neutral" || baseExpression === "default" || baseExpression === "idle",
    ) ??
    pools.find((pool) => pool.length > 0)?.[0]?.url ??
    null
  );
}

export function normalizeSpriteExpressionMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const expressions: Record<string, string> = {};
  for (const [key, expression] of Object.entries(value as Record<string, unknown>)) {
    if (typeof expression !== "string") continue;
    const trimmedKey = key.trim();
    const trimmedExpression = expression.trim();
    if (trimmedKey && trimmedExpression) expressions[trimmedKey] = trimmedExpression;
  }
  return expressions;
}

function getSpriteExpressionForOwner(
  expressions: Record<string, string>,
  ownerKind: SpriteOwnerKind,
  ownerId: string | null | undefined,
  displayName?: string | null,
): string | undefined {
  const id = ownerId?.trim();
  const candidates = [id ? makeSpriteOwnerKey(ownerKind, id) : null, id, displayName?.trim() || null].filter(
    (candidate): candidate is string => !!candidate,
  );
  for (const candidate of candidates) {
    const expression = expressions[candidate];
    if (expression) return expression;
  }
  return undefined;
}

export function getSpriteExpressionForOwnerKey(
  expressions: Record<string, string>,
  ownerKey: string,
  displayName?: string | null,
): string | undefined {
  const ownerKind = getSpriteOwnerKind(ownerKey);
  const ownerId = getSpriteOwnerId(ownerKey);
  const keyedExpression = expressions[ownerKey];
  if (keyedExpression) return keyedExpression;
  return getSpriteExpressionForOwner(expressions, ownerKind, ownerId, displayName);
}

export function getSpriteExpressionForCharacter(
  expressions: Record<string, string>,
  characterId: string | null | undefined,
  displayName?: string | null,
): string | undefined {
  return getSpriteExpressionForOwner(expressions, "character", characterId, displayName);
}

export function getSpriteExpressionForPersona(
  expressions: Record<string, string>,
  personaId: string | null | undefined,
  displayName?: string | null,
): string | undefined {
  return getSpriteExpressionForOwner(expressions, "persona", personaId, displayName);
}
