import { hasLorebookEntries } from "../../../../shared/lib/character-import";
import type { BrowserCard, CharacterDetail, ProviderId } from "./providers/types";

/** A character card's fields, built from what the screen shows: the card plus its detail. */
export interface CardFields {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  character_version: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  extensions: Record<string, unknown>;
  character_book?: unknown;
}

/**
 * The card a built import sends and Download as PNG writes. The description falls back to the personality, which
 * then stays only when there is a real description. The extensions carry the provider marker after the detail's
 * own extensions.
 */
export function buildCardFields(
  providerId: ProviderId,
  card: BrowserCard,
  detail: CharacterDetail | null | undefined,
): CardFields {
  const fields: CardFields = {
    name: card.name,
    description: detail?.description || detail?.personality || "",
    personality: detail?.description ? detail.personality || "" : "",
    scenario: detail?.scenario || "",
    first_mes: detail?.firstMessage || "",
    mes_example: detail?.exampleDialogs || "",
    creator_notes: detail?.creatorNotes || "",
    system_prompt: detail?.systemPrompt || "",
    post_history_instructions: detail?.postHistoryInstructions || "",
    character_version: detail?.characterVersion || "",
    alternate_greetings: detail?.alternateGreetings ?? [],
    tags: card.tags,
    creator: card.creator,
    extensions: { ...(detail?.providerExtensions ?? {}), [providerId]: { id: card.id } },
  };
  if (hasLorebookEntries(detail?.embeddedLorebook)) fields.character_book = detail?.embeddedLorebook;
  return fields;
}

/** The source marker the importer saves as `extensions.botBrowserSource`. */
export function botBrowserSource(providerId: ProviderId, card: BrowserCard): string {
  return `${providerId}:${card.id}`;
}
