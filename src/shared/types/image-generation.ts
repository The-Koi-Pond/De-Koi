export interface ImageGenerationConnectionOption {
  id: string;
  name: string;
  model?: string | null;
  provider?: string | null;
  defaultForAgents?: boolean | string | null;
}

export function isDefaultImageGenerationConnection(connection: ImageGenerationConnectionOption): boolean {
  return connection.defaultForAgents === true || connection.defaultForAgents === "true";
}
