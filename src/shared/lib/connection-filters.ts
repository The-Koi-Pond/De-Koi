export type ConnectionProviderLike = {
  provider?: string | null;
};

function isLanguageGenerationConnection(connection: ConnectionProviderLike): boolean {
  return connection.provider !== "image_generation";
}

export function filterLanguageGenerationConnections<T extends ConnectionProviderLike>(
  connections: readonly T[] | null | undefined,
): T[] {
  return (connections ?? []).filter(isLanguageGenerationConnection);
}

/** Providers that can reply without a saved API key: subscription logins read locally, and Custom (local models). */
const KEYLESS_PROVIDERS = new Set(["claude_subscription", "openai_chatgpt", "custom"]);

/**
 * A language connection that can actually reply: it has a model picked and, unless the provider works without one,
 * a saved API key. The create dialog pre-fills a default model for some providers, and the server refuses to generate
 * without a model ("Connection model is required"), so neither alone proves the connection works.
 */
export function isConnectionReadyToReply(connection: {
  provider?: string | null;
  model?: string | null;
  hasApiKey?: boolean | null;
}): boolean {
  const hasModel = typeof connection.model === "string" && connection.model.trim().length > 0;
  const provider = connection.provider?.trim().toLowerCase() ?? "";
  return hasModel && (connection.hasApiKey === true || KEYLESS_PROVIDERS.has(provider));
}
