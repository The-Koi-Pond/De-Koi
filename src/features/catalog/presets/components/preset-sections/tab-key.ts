import type { KeyboardEvent } from "react";

/**
 * Tab in a prompt text area inserts two spaces at the cursor (replacing a selection) and hands the new text to
 * `onChange`; the cursor lands after the spaces once the new text is shown.
 */
export function insertTabSpaces(event: KeyboardEvent<HTMLTextAreaElement>, onChange: (text: string) => void) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const area = event.currentTarget;
  const { selectionStart: start, selectionEnd: end, value } = area;
  onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
  requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
}
