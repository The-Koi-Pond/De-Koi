import { formatTextQuotes, type QuoteFormat } from "./dialogue-quotes";

export function applyTextareaQuoteFormat(textarea: HTMLTextAreaElement, quoteFormat: QuoteFormat): string {
  const raw = textarea.value;
  const formatted = formatTextQuotes(raw, quoteFormat);
  if (raw === formatted) return formatted;

  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const selectionDirection = textarea.selectionDirection;
  textarea.value = formatted;
  textarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  return formatted;
}
