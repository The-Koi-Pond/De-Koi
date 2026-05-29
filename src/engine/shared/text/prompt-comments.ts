import { collapseExcessBlankLines } from "./newlines";

const PROMPT_COMMENT_RE = /\{\{\s*\/\/[\s\S]*?\}\}/g;

export function stripPromptComments(text: string): string {
  return text.replace(PROMPT_COMMENT_RE, "");
}

export function cleanPromptText(text: string): string {
  return collapseExcessBlankLines(stripPromptComments(text)).trim();
}
