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

export type InlineCardTokenWarning = {
  label: string;
  description: string;
};

export function getInlineCardTokenWarning(tokens: number): InlineCardTokenWarning | null {
  if (!isCardTokenEstimateOverRecommendation(tokens)) return null;
  return {
    label: "Long card",
    description: `${formatEstimatedTokens(tokens)}; recommended maximum is ${formatEstimatedTokens(CARD_TOKEN_RECOMMENDED_LIMIT)}. Open this character and shorten the card.`,
  };
}
export type CardLengthToastKind = "character" | "persona";

export type CardLengthToastAction =
  | {
      action: "show";
      toastId: string;
      title: string;
      description: string;
      duration: number;
      closeButton: boolean;
    }
  | { action: "dismiss"; toastId: string };

function capitalizeCardKind(cardKind: CardLengthToastKind): string {
  return cardKind === "character" ? "Character" : "Persona";
}

function getCardLengthToastId(cardKind: CardLengthToastKind, cardId: string): string {
  return `${cardKind}-card-length-${cardId}`;
}

export function getCardLengthToastActions({
  cardKind,
  cardId,
  tokenEstimate,
  previousToastId,
}: {
  cardKind: CardLengthToastKind;
  cardId: string | null | undefined;
  tokenEstimate: number | null | undefined;
  previousToastId: string | null | undefined;
}): CardLengthToastAction[] {
  const actions: CardLengthToastAction[] = [];
  const toastId = cardId ? getCardLengthToastId(cardKind, cardId) : null;

  if (previousToastId && previousToastId !== toastId) {
    actions.push({ action: "dismiss", toastId: previousToastId });
  }

  if (!toastId || tokenEstimate == null) return actions;

  if (!isCardTokenEstimateOverRecommendation(tokenEstimate)) {
    if (previousToastId === toastId) actions.push({ action: "dismiss", toastId });
    return actions;
  }

  const label = capitalizeCardKind(cardKind);
  actions.push({
    action: "show",
    toastId,
    title: `${label} card is longer than recommended.`,
    description: `${formatEstimatedTokens(tokenEstimate)} used. Recommendation: ${formatEstimatedTokens(CARD_TOKEN_RECOMMENDED_LIMIT)}. It will still save.`,
    duration: Infinity,
    closeButton: true,
  });
  return actions;
}
