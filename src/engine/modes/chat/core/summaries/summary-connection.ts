import type { StorageGateway } from "../../../../capabilities/storage";
import { noteHelperRun, type HelperRunRule } from "../../../../generation/helper-runs";
import {
  assertLocalOnlyConnection,
  isModelRouteError,
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
export async function pickChatSummaryConnection(
  storage: Pick<StorageGateway, "get" | "list">,
  chat: { connectionId?: unknown },
): Promise<{ connectionId: string; rule: HelperRunRule }> {
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
    return { connectionId: summaryConnectionId, rule: "agent" };
  }
  const routed = resolveModelRoute("summaries", settings, connections);
  if (routed) return { connectionId: readString(routed.id).trim(), rule: "route" };
  const agentDefault = connections.find((connection) => boolish(connection.defaultForAgents, false));
  const agentDefaultId = readString(agentDefault?.id).trim();
  if (agentDefaultId) return { connectionId: agentDefaultId, rule: "agentDefault" };
  const chatConnectionId = readString(chat.connectionId).trim();
  if (chatConnectionId) return { connectionId: chatConnectionId, rule: "chat" };
  const appDefault = connections.find(
    (connection) => boolish(connection.isDefault, false) || boolish(connection.default, false),
  );
  const selected = appDefault ?? connections[0];
  const connectionId = readString(selected?.id).trim();
  if (!connectionId) throw new Error("No API connection configured for summary generation.");
  return { connectionId, rule: appDefault ? "appDefault" : "first" };
}

/** {@link pickChatSummaryConnection} for a Summarize chat run: notes where it ran and why, or why it stopped. */
export async function resolveChatSummaryRunConnectionId(
  storage: Pick<StorageGateway, "get" | "list" | "create" | "update">,
  chat: { id?: unknown; connectionId?: unknown },
): Promise<string> {
  const note = { task: "summaries" as const, job: "Summarize chat", chatId: readString(chat.id).trim() };
  try {
    const { connectionId, rule } = await pickChatSummaryConnection(storage, chat);
    await noteHelperRun(storage, { ...note, rule, connectionId });
    return connectionId;
  } catch (error) {
    if (isModelRouteError(error)) {
      await noteHelperRun(storage, {
        ...note,
        rule: "route",
        connectionId: error.connectionId,
        problem: error.message,
      });
    }
    throw error;
  }
}
