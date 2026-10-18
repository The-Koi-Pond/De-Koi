// ──────────────────────────────────────────────
// Fanfic web research: what the server-side search and page reading hand back
// ──────────────────────────────────────────────

export interface FanficWebSource {
  query: string;
  title: string;
  url: string;
  snippet: string;
  text: string;
}

export interface FanficWebResearchResult {
  sources: FanficWebSource[];
  failures: unknown[];
}

/** Server-side search plus page reading for one fic; the server checks the fic opted in. */
export interface FanficWebResearchGateway {
  /** focus "voice" reads each page's Quotes section instead of its opening. */
  research(input: { chatId: string; queries: string[]; focus?: "voice" }): Promise<FanficWebResearchResult>;
}
