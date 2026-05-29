import { translationApi } from "../api/translation-api";
import { useTranslationStore } from "../stores/translation.store";

/** Standalone translate helper for on-demand translation flows. */
export async function translateText(text: string): Promise<string> {
  const store = useTranslationStore.getState();
  const result = await translationApi.translateText({
    text,
    provider: store.config.provider,
    targetLanguage: store.config.targetLanguage,
    connectionId: store.config.connectionId,
    deeplApiKey: store.config.deeplApiKey,
    deeplxUrl: store.config.deeplxUrl,
  });
  return result.translatedText;
}
