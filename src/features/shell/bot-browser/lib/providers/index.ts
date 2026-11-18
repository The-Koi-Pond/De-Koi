import { chartavernProvider } from "./chartavern";
import { chubProvider } from "./chub";
import { datacatProvider } from "./datacat";
import { jannyProvider } from "./janny";
import { pygmalionProvider } from "./pygmalion";
import type { BrowserProvider, ProviderId } from "./types";
import { wyvernProvider } from "./wyvern";

/** The six providers, in the switcher's order. ChubAI is the default. */
export const BROWSER_PROVIDERS: readonly BrowserProvider[] = [
  chubProvider,
  jannyProvider,
  chartavernProvider,
  pygmalionProvider,
  wyvernProvider,
  datacatProvider,
];

export const DEFAULT_PROVIDER_ID: ProviderId = "chub";

export function providerById(id: ProviderId): BrowserProvider {
  return BROWSER_PROVIDERS.find((provider) => provider.id === id) ?? chubProvider;
}
