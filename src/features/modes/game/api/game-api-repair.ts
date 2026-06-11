import * as g from "./game-api-support";
import { isGameSetupConfig } from "./game-api-session-helpers";
import { generateMap } from "./game-api-map";
import { upsertPartyCard } from "./game-api-party";
import { concludeSession, setupGame, updateCampaignProgression } from "./game-api-session";
import { regenerateSessionLorebook } from "./game-api-lorebook-keeper";

export async function applyGameJsonRepair(request: g.JsonRepairRequest, rawJson: string): Promise<unknown> {
  const repaired = g.parseJsonObject(rawJson);
  if (!repaired) {
    throw new Error("Repaired JSON is not a JSON object.");
  }
  const body = g.asRecord(request.applyBody);
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : undefined;
  const kind = typeof request.kind === "string" ? request.kind : "";

  if (!chatId) throw new Error("JSON repair request is missing its target chat.");

  switch (kind) {
    case "game_setup":
      return setupGame({
        chatId,
        connectionId,
        preferences: typeof body.preferences === "string" ? body.preferences : "",
        setupConfig: isGameSetupConfig(body.setupConfig) ? body.setupConfig : undefined,
        setup: repaired,
      });
    case "game_map":
      return generateMap({
        chatId,
        connectionId,
        locationType: typeof body.locationType === "string" ? body.locationType : "Area",
        context: typeof body.context === "string" ? body.context : "",
        generated: repaired,
      });
    case "session_conclusion":
      return concludeSession({
        chatId,
        connectionId,
        nextSessionRequest: typeof body.nextSessionRequest === "string" ? body.nextSessionRequest : undefined,
        generated: repaired,
      });
    case "session_lorebook":
      return regenerateSessionLorebook({
        chatId,
        connectionId,
        sessionNumber: Number(body.sessionNumber ?? 1),
        generated: repaired,
      });
    case "campaign_progression":
      return updateCampaignProgression({
        chatId,
        connectionId,
        sessionNumber: Number(body.sessionNumber ?? 1),
        generated: repaired,
      });
    case "party_card":
      return upsertPartyCard({
        chatId,
        connectionId,
        characterName: typeof body.characterName === "string" ? body.characterName : "",
        characterId: typeof body.characterId === "string" ? body.characterId : undefined,
        added: body.added === true,
        generated: repaired,
      });
    default:
      throw new Error("Unsupported game JSON repair request.");
  }
}
