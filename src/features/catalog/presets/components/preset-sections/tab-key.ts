import type { KeyboardEvent } from "react";

/**
 * Tab in a prompt text area inserts two spaces at the cursor (replacing a selection) into the text as the editor
 * holds it and hands the new text to `onChange`; the cursor lands after the spaces once the new text is shown. Text
 * that isn't a string (a stored `null` or number, kept as stored) makes it throw and insert nothing, as recorded.
 */
export function insertTabSpaces(
  event: KeyboardEvent<HTMLTextAreaElement>,
  value: unknown,
  onChange: (text: string) => void,
) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const area = event.currentTarget;
  const { selectionStart: start, selectionEnd: end } = area;
  const text = value as string;
  onChange(`${text.substring(0, start)}  ${text.substring(end)}`);
  requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
}
