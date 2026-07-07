import { toast } from "sonner";
import { toUserMessage } from "./error-message";

export async function translateDraftText(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const { translateText } = await import("./translate-text");
    return await translateText(trimmed);
  } catch (error) {
    toast.error(toUserMessage(error, "translateDraft"));
    return null;
  }
}
