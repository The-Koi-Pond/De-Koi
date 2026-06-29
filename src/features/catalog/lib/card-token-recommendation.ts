const CHARS_PER_TOKEN = 4;

export const CARD_TOKEN_RECOMMENDED_LIMIT = 3200;

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function formatEstimatedTokens(tokens: number): string {
  return `~${tokens.toLocaleString()} tokens`;
}

export function isCardTokenEstimateOverRecommendation(tokens: number): boolean {
  return tokens > CARD_TOKEN_RECOMMENDED_LIMIT;
}
