import { useCallback, useEffect, useRef, useState } from "react";
import { translateDraftText } from "../lib/draft-translation";
import { createTranslationRequest, type TranslationRequest } from "../lib/translation-request";

export function getDraftTranslationActionState({
  isTranslating,
  canStart,
}: {
  isTranslating: boolean;
  canStart: boolean;
}): { action: "cancel" | "translate"; disabled: boolean } {
  return isTranslating
    ? { action: "cancel", disabled: false }
    : { action: "translate", disabled: !canStart };
}

export function useDraftTranslation() {
  const activeRequestRef = useRef<TranslationRequest<string | null> | null>(null);
  const [isTranslatingDraft, setIsTranslatingDraft] = useState(false);

  const cancelDraftTranslation = useCallback(() => {
    activeRequestRef.current?.cancel();
    activeRequestRef.current = null;
    setIsTranslatingDraft(false);
  }, []);

  useEffect(() => cancelDraftTranslation, [cancelDraftTranslation]);

  const translateDraft = useCallback(async (text: string): Promise<string | null> => {
    activeRequestRef.current?.cancel();
    const request = createTranslationRequest((signal) => translateDraftText(text, { signal }));
    activeRequestRef.current = request;
    setIsTranslatingDraft(true);
    try {
      const result = await request.run();
      if (result.status === "cancelled" || activeRequestRef.current !== request) return null;
      return result.value;
    } finally {
      if (activeRequestRef.current === request) {
        activeRequestRef.current = null;
        setIsTranslatingDraft(false);
      }
    }
  }, []);

  return { isTranslatingDraft, translateDraft, cancelDraftTranslation };
}
