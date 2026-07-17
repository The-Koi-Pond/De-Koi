import { toast } from "sonner";
import { toUserMessage } from "./error-message";

export async function translateDraftText(text: string, options: { signal?: AbortSignal } = {}): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const { translateText } = await import("./translate-text");
    return await translateText(trimmed, options);
  } catch (error) {
    if (options.signal?.aborted) return null;
    toast.error(toUserMessage(error, "translateDraft"));
    return null;
  }
}
