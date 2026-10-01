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

export type DefaultConnectionCandidate = ConnectionProviderLike & {
  id: string;
  isDefault?: boolean | null;
};

/**
 * The language connection a surface should start with when the user has not
 * picked one: the connection marked default, or the only one there is.
 */
export function pickDefaultLanguageConnection<T extends DefaultConnectionCandidate>(
  connections: readonly T[] | null | undefined,
): T | null {
  const languageConnections = filterLanguageGenerationConnections(connections);
  return (
    languageConnections.find((connection) => connection.isDefault === true) ??
    (languageConnections.length === 1 ? languageConnections[0]! : null)
  );
}
