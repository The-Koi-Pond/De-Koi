import {
  DEFAULT_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH,
  MAX_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH,
  testPrimaryKeys,
} from "@marinara-engine/shared";

export interface ActivationScanMessage {
  content?: unknown;
}

export interface AgentActivationMatch {
  configured: boolean;
  matched: boolean;
  keywords: string[];
  matchedKeywords: string[];
  scanDepth: number;
}

export function normalizeAgentActivationKeywords(value: unknown): string[] {
  const rawKeywords =
    typeof value === "string"
      ? value.split(/\r?\n|,/)
      : Array.isArray(value)
        ? value
        : [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const rawKeyword of rawKeywords) {
    if (typeof rawKeyword !== "string") continue;
    const keyword = rawKeyword.trim();
    if (!keyword) continue;
    const dedupeKey = keyword.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    keywords.push(keyword);
  }

  return keywords;
}

export function normalizeAgentActivationScanDepth(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH;
  return Math.max(1, Math.min(MAX_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH, Math.floor(parsed)));
}

export function matchCustomAgentActivation(
  settings: Record<string, unknown>,
  messages: ActivationScanMessage[],
): AgentActivationMatch {
  const keywords = normalizeAgentActivationKeywords(settings.activationKeywords);
  const scanDepth = normalizeAgentActivationScanDepth(settings.activationScanDepth);

  if (keywords.length === 0) {
    return { configured: false, matched: true, keywords, matchedKeywords: [], scanDepth };
  }

  const scanText = messages
    .slice(-scanDepth)
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .filter(Boolean)
    .join("\n");
  const result = testPrimaryKeys(keywords, scanText, {
    useRegex: false,
    matchWholeWords: false,
    caseSensitive: false,
  });

  return {
    configured: true,
    matched: result.matched,
    keywords,
    matchedKeywords: result.matchedKeys,
    scanDepth,
  };
}
