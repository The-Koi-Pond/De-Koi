import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import { buildMainToolDefinitions, type CharacterWebResearchGrant, type MainToolDefinitions } from "./tools-runtime";
import { parseRecord, readString, type JsonRecord } from "./runtime-records";

export type CharacterWebResearchApproval = "once" | "always";
type CharacterWebResearchPolicy = "ask" | "always";

function characterWebResearchPolicy(metadata: unknown): CharacterWebResearchPolicy {
  return parseRecord(metadata).characterWebResearchPolicy === "always" ? "always" : "ask";
}

export function createCharacterWebResearchGrant(args: {
  requestMessageId: string;
  query: string;
  allowedDomains?: string[] | null;
  id?: string;
  now?: Date;
}): CharacterWebResearchGrant {
  const now = args.now ?? new Date();
  return {
    id: readString(args.id).trim() || `character-web-${crypto.randomUUID()}`,
    query: args.query.trim(),
    allowedDomains: (args.allowedDomains ?? []).map((domain) => domain.trim()).filter(Boolean),
    requestMessageId: args.requestMessageId.trim(),
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
}

export function characterWebResearchApprovalPatch(
  approval: CharacterWebResearchApproval,
  grant: CharacterWebResearchGrant,
): Record<string, unknown> {
  return {
    ...(approval === "always" ? { characterWebResearchPolicy: "always" } : {}),
    characterWebResearchGrant: grant,
  };
}

export async function activateAlwaysAllowedCharacterWebResearch(args: {
  storage: StorageGateway;
  integrations: IntegrationGateway;
  chat: JsonRecord;
  requestMessageId: string;
  query: string;
  allowedDomains?: string[] | null;
  id?: string;
  now?: Date;
}): Promise<{
  grant: CharacterWebResearchGrant;
  chat: JsonRecord;
  mainTools: MainToolDefinitions;
  release: () => Promise<void>;
}> {
  const chatId = readString(args.chat.id).trim();
  if (!chatId) throw new Error("Character web research requires a chat id.");
  if (characterWebResearchPolicy(args.chat.metadata) !== "always") {
    throw new Error("Character web research is not always allowed for this chat.");
  }
  const grant = createCharacterWebResearchGrant(args);
  await args.storage.patchChatMetadata(chatId, { characterWebResearchGrant: grant });
  const chat = {
    ...args.chat,
    metadata: {
      ...parseRecord(args.chat.metadata),
      characterWebResearchGrant: grant,
    },
  };
  const mainTools = await buildMainToolDefinitions({
    chat,
    storage: args.storage,
    integrations: args.integrations,
  });
  if (!mainTools?.characterWebResearchGrant) {
    throw new Error("Character web research grant could not be activated.");
  }
  let released = false;
  return {
    grant,
    chat,
    mainTools,
    release: async () => {
      if (released) return;
      released = true;
      await args.storage.patchChatMetadata(chatId, { characterWebResearchGrant: null });
    },
  };
}
