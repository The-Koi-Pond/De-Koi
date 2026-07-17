import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { storageApi } from "../api/storage-api";
import { toUserMessage } from "../lib/error-message";
import { translationApi } from "../api/translation-api";
import { useTranslationStore } from "../stores/translation.store";
import { createTranslationRequest, type TranslationRequest } from "../lib/translation-request";

const activeMessageTranslations = new Map<string, TranslationRequest<{ translatedText: string }>>();

async function patchMessageExtra(messageId: string, patch: Record<string, unknown>) {
  const message = await storageApi.get<{ extra?: unknown }>("messages", messageId);
  const extra =
    message?.extra && typeof message.extra === "object" && !Array.isArray(message.extra)
      ? { ...(message.extra as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete extra[key];
    } else {
      extra[key] = value;
    }
  }
  await storageApi.update("messages", messageId, { extra });
}

export function useTranslate() {
  const ownedMessageIdsRef = useRef(new Set<string>());
  const config = useTranslationStore((s) => s.config);
  const translations = useTranslationStore((s) => s.translations);
  const translating = useTranslationStore((s) => s.translating);
  const setTranslation = useTranslationStore((s) => s.setTranslation);
  const removeTranslation = useTranslationStore((s) => s.removeTranslation);
  const setTranslating = useTranslationStore((s) => s.setTranslating);

  const translate = useCallback(
    async (messageId?: string, content?: string, chatId?: string) => {
      if (!messageId || !content?.trim()) return;
      if (translations[messageId]) {
        removeTranslation(messageId);
        if (chatId) {
          patchMessageExtra(messageId, { translation: null }).catch((error) =>
            console.warn("[translation] Failed to clear persisted translation", error),
          );
        }
        return;
      }
      activeMessageTranslations.get(messageId)?.cancel();
      const request = createTranslationRequest((signal) =>
        translationApi.translateText(
          {
            text: content,
            provider: config.provider,
            targetLanguage: config.targetLanguage,
            connectionId: config.connectionId,
            deeplApiKey: config.deeplApiKey,
            deeplxUrl: config.deeplxUrl,
          },
          { signal },
        ),
      );
      activeMessageTranslations.set(messageId, request);
      ownedMessageIdsRef.current.add(messageId);
      setTranslating(messageId, true);
      try {
        const result = await request.run();
        if (result.status === "cancelled" || activeMessageTranslations.get(messageId) !== request) return;
        setTranslation(messageId, result.value.translatedText);
        if (chatId) {
          await patchMessageExtra(messageId, { translation: result.value.translatedText }).catch((error) =>
            console.warn("[translation] Failed to persist translation", error),
          );
          if (request.signal.aborted) {
            removeTranslation(messageId);
            await patchMessageExtra(messageId, { translation: null }).catch((error) =>
              console.warn("[translation] Failed to clear cancelled translation", error),
            );
          }
        }
      } catch (error) {
        toast.error(toUserMessage(error, "translateMessage"));
      } finally {
        if (activeMessageTranslations.get(messageId) === request) {
          activeMessageTranslations.delete(messageId);
          ownedMessageIdsRef.current.delete(messageId);
          setTranslating(messageId, false);
        }
      }
    },
    [config, removeTranslation, setTranslating, setTranslation, translations],
  );

  const cancelTranslation = useCallback(
    (messageId: string, chatId?: string) => {
      activeMessageTranslations.get(messageId)?.cancel();
      activeMessageTranslations.delete(messageId);
      ownedMessageIdsRef.current.delete(messageId);
      removeTranslation(messageId);
      setTranslating(messageId, false);
      if (chatId) {
        void patchMessageExtra(messageId, { translation: null }).catch((error) =>
          console.warn("[translation] Failed to clear cancelled translation", error),
        );
      }
    },
    [removeTranslation, setTranslating],
  );

  useEffect(
    () => () => {
      for (const messageId of ownedMessageIdsRef.current) {
        activeMessageTranslations.get(messageId)?.cancel();
        activeMessageTranslations.delete(messageId);
        setTranslating(messageId, false);
      }
      ownedMessageIdsRef.current.clear();
    },
    [setTranslating],
  );

  return {
    translations,
    translating,
    translateMessage: translate,
    translate,
    cancelTranslation,
  };
}
