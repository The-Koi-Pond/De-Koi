import { useMutation } from "@tanstack/react-query";

import {
  previewGenerationPrompt,
  type PromptPreviewInput,
  type PromptPreviewResult,
} from "../../../../../engine/generation/prompt-preview";
import { storageApi } from "../../../../../shared/api/storage-api";
import { visualAssetsApi } from "../../../../../shared/api/visual-assets-api";

/** Peek at the assembled prompt for a chat. */
export function usePeekPrompt() {
  return useMutation({
    mutationFn: (input: string | PromptPreviewInput): Promise<PromptPreviewResult> => {
      const request: PromptPreviewInput = typeof input === "string" ? { chatId: input } : input;
      return previewGenerationPrompt(storageApi, request, visualAssetsApi);
    },
  });
}
