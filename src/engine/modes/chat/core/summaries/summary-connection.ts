import type { StorageGateway } from "../../../../capabilities/storage";
import {
  assertLocalOnlyConnection,
  readModelRoutingSettings,
  resolveModelRoute,
} from "../../../../generation/model-routing";
import { boolish, readString, type JsonRecord } from "../../../../generation/runtime-records";

/**
 * The connection for Summarize chat: the Chat Summary agent's own connection,
 * then the summaries helper route, then Default for Agents, the chat's
 * connection, and the app default. A local-only Summaries helper stays local even
 * on the agent's own connection.
 */
export async function resolveChatSummaryConnectionId(
  storage: Pick<StorageGateway, "get" | "list">,
  chat: { connectionId?: unknown },
): Promise<string> {
  const [agents, connections] = await Promise.all([
    storage.list<JsonRecord>("agents").catch(() => []),
    storage.list<JsonRecord>("connections"),
  ]);
  const summaryAgent = agents.find(
    (agent) => readString(agent.id).trim() === "chat-summary" || readString(agent.type).trim() === "chat-summary",
  );
  const settings = await readModelRoutingSettings(storage);
  const summaryConnectionId = readString(summaryAgent?.connectionId).trim();
  if (summaryConnectionId) {
    const own = connections.find((connection) => readString(connection.id).trim() === summaryConnectionId);
    assertLocalOnlyConnection("summaries", settings, summaryConnectionId, own);
    return summaryConnectionId;
  }
  const routed = resolveModelRoute("summaries", settings, connections);
  if (routed) return readString(routed.id).trim();
  const agentDefault = connections.find((connection) => boolish(connection.defaultForAgents, false));
  const agentDefaultId = readString(agentDefault?.id).trim();
  if (agentDefaultId) return agentDefaultId;
  const chatConnectionId = readString(chat.connectionId).trim();
  if (chatConnectionId) return chatConnectionId;
  const selected =
    connections.find((connection) => boolish(connection.isDefault, false) || boolish(connection.default, false)) ??
    connections[0];
  const connectionId = readString(selected?.id).trim();
  if (!connectionId) throw new Error("No API connection configured for summary generation.");
  return connectionId;
}
