export function collapseExcessBlankLines(text: string): string {
  return text.replace(/\n([ \t]*\n){2,}/g, "\n\n");
}
