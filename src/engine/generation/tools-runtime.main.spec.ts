import { describe, expect, it } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import {
  buildMainToolDefinitions,
  CHARACTER_WEB_RESEARCH_REQUEST_TOOL_NAME,
  CHARACTER_WEB_SEARCH_TOOL_NAME,
  executeMainToolCall,
} from "./tools-runtime";
import type { JsonRecord } from "./runtime-records";

const BUILT_IN_NAME = "roll_dice";
const OTHER_BUILT_IN_NAME = "update_game_state";
const CUSTOM_NAME = "lookup_weather";

function storageWithCustomTools(customTools: JsonRecord[] = []): StorageGateway {
  return {
    async list(entity: string) {
      return (entity === "custom-tools" ? customTools : []) as never[];
    },
  } as unknown as StorageGateway;
}

const integrations = {} as IntegrationGateway;

function chat(metadata: JsonRecord): JsonRecord {
  return { id: "chat-1", mode: "conversation", metadata };
}

function enabledCustomTool(name: string): JsonRecord {
  return {
    id: `custom-${name}`,
    name,
    description: `Run ${name}.`,
    parametersSchema: { type: "object", properties: {} },
    executionType: "static",
    staticResult: "ok",
    enabled: true,
  };
}

async function build(metadata: JsonRecord, customTools: JsonRecord[] = []) {
  return buildMainToolDefinitions({
    chat: chat(metadata),
    storage: storageWithCustomTools(customTools),
    integrations,
  });
}

function runtimeInput(metadata: JsonRecord) {
  return {
    chat: chat(metadata),
    activatedLorebookEntries: [],
    characters: [],
    persona: null,
    chatSummary: null,
  };
}

describe("main generation tool selection", () => {
  it("advertises no tools when chat-level tools are disabled", async () => {
    expect(await build({ enableTools: false, toolSelectionMode: "all", activeToolIds: [] })).toBeNull();
  });

  it("advertises no tools for an explicit empty selection", async () => {
    expect(await build({ enableTools: true, toolSelectionMode: "explicit", activeToolIds: [] })).toBeNull();
  });

  it("advertises only an explicit subset and uses the same dispatcher allowlist", async () => {
    const result = await build(
      {
        enableTools: true,
        toolSelectionMode: "explicit",
        activeToolIds: [BUILT_IN_NAME, CUSTOM_NAME, "unknown_tool"],
      },
      [enabledCustomTool(CUSTOM_NAME)],
    );

    expect(result?.toolDefs.map((tool) => tool.name)).toEqual([BUILT_IN_NAME, CUSTOM_NAME]);
    expect([...result!.allowedToolNames]).toEqual(result!.toolDefs.map((tool) => tool.name));
  });

  it("preserves the legacy empty-selection behavior as all available tools", async () => {
    const result = await build({ enableTools: true, activeToolIds: [] }, [enabledCustomTool(CUSTOM_NAME)]);

    expect(result?.toolDefs.map((tool) => tool.name)).toContain(BUILT_IN_NAME);
    expect(result?.toolDefs.map((tool) => tool.name)).toContain(OTHER_BUILT_IN_NAME);
    expect(result?.toolDefs.map((tool) => tool.name)).toContain(CUSTOM_NAME);
  });

  it("preserves a legacy non-empty selection as an explicit subset", async () => {
    const result = await build({ enableTools: true, activeToolIds: [BUILT_IN_NAME] });

    expect(result?.toolDefs.map((tool) => tool.name)).toEqual([BUILT_IN_NAME]);
  });

  it("does not advertise unknown explicit IDs", async () => {
    expect(
      await build({ enableTools: true, toolSelectionMode: "explicit", activeToolIds: ["unknown_tool"] }),
    ).toBeNull();
  });

  it("keeps the built-in definition when a selected custom tool collides by name", async () => {
    const result = await build({ enableTools: true, toolSelectionMode: "explicit", activeToolIds: [BUILT_IN_NAME] }, [
      enabledCustomTool(BUILT_IN_NAME),
    ]);

    expect(result?.toolDefs.map((tool) => tool.name)).toEqual([BUILT_IN_NAME]);
    expect(result?.customTools.size).toBe(0);
    expect([...result!.allowedToolNames]).toEqual([BUILT_IN_NAME]);
  });

  it("sends a smaller schema for one selected tool than for legacy all", async () => {
    const selected = await build({
      enableTools: true,
      toolSelectionMode: "explicit",
      activeToolIds: [BUILT_IN_NAME],
    });
    const legacyAll = await build({ enableTools: true, activeToolIds: [] });

    expect(JSON.stringify(selected?.toolDefs).length).toBeLessThan(JSON.stringify(legacyAll?.toolDefs).length);
  });

  it("advertises only a consent request tool when character web access is enabled without a grant", async () => {
    const result = await build({
      enableTools: false,
      characterWebAccessEnabled: true,
    });

    expect(result?.toolDefs.map((tool) => tool.name)).toEqual(["request_character_web_research"]);
  });

  it("advertises bounded web tools instead of the request tool for an unexpired exact-query grant", async () => {
    const result = await build({
      enableTools: false,
      characterWebAccessEnabled: true,
      characterWebResearchGrant: {
        id: "grant-1",
        query: "current lunar eclipse date",
        allowedDomains: ["nasa.gov"],
        requestMessageId: "message-1",
        grantedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:05:00.000Z",
      },
    });

    expect(result?.toolDefs.map((tool) => tool.name)).toEqual(["search_character_web", "read_character_web_page"]);
    expect(result?.characterWebResearchGrant?.id).toBe("grant-1");
  });

  it("falls back to requesting consent when the stored web grant is expired", async () => {
    const result = await build({
      enableTools: false,
      characterWebAccessEnabled: true,
      characterWebResearchGrant: {
        id: "grant-expired",
        query: "old query",
        allowedDomains: [],
        requestMessageId: "message-1",
        grantedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-01T00:05:00.000Z",
      },
    });

    expect(result?.toolDefs.map((tool) => tool.name)).toEqual(["request_character_web_research"]);
    expect(result?.characterWebResearchGrant).toBeNull();
    expect(result?.characterWebResearchGrantState).toBe("expired");
  });

  it("turns a request tool call into a structured permission request without using the network", async () => {
    const metadata = { characterWebAccessEnabled: true };
    const definitions = await build(metadata);
    const result = await executeMainToolCall({
      deps: { storage: storageWithCustomTools(), integrations },
      input: runtimeInput(metadata),
      customTools: definitions!.customTools,
      allowedToolNames: definitions!.allowedToolNames,
      characterWebResearchGrant: definitions!.characterWebResearchGrant,
      characterWebResearchGrantState: definitions!.characterWebResearchGrantState,
      call: {
        name: CHARACTER_WEB_RESEARCH_REQUEST_TOOL_NAME,
        arguments: JSON.stringify({
          query: "current lunar eclipse date",
          reason: "The date may have changed.",
          allowedDomains: ["nasa.gov"],
        }),
        function: {
          name: CHARACTER_WEB_RESEARCH_REQUEST_TOOL_NAME,
          arguments: JSON.stringify({
            query: "current lunar eclipse date",
            reason: "The date may have changed.",
            allowedDomains: ["nasa.gov"],
          }),
        },
      },
    });

    expect(JSON.parse(result)).toEqual({
      kind: "character_web_research_request",
      query: "current lunar eclipse date",
      reason: "The date may have changed.",
      allowedDomains: ["nasa.gov"],
    });
  });

  it("injects the approved exact query and grant into web search execution", async () => {
    const calls: JsonRecord[] = [];
    const metadata = {
      characterWebAccessEnabled: true,
      characterWebResearchGrant: {
        id: "grant-1",
        query: "current lunar eclipse date",
        allowedDomains: ["nasa.gov"],
        requestMessageId: "message-1",
        grantedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:05:00.000Z",
      },
    };
    const webIntegrations = {
      webResearch: {
        search: async (input: JsonRecord) => {
          calls.push(input);
          return { results: [] };
        },
        readPage: async () => ({ text: "" }),
      },
    } as unknown as IntegrationGateway;
    const definitions = await buildMainToolDefinitions({
      chat: chat(metadata),
      storage: storageWithCustomTools(),
      integrations: webIntegrations,
    });

    await executeMainToolCall({
      deps: { storage: storageWithCustomTools(), integrations: webIntegrations },
      input: runtimeInput(metadata),
      customTools: definitions!.customTools,
      allowedToolNames: definitions!.allowedToolNames,
      characterWebResearchGrant: definitions!.characterWebResearchGrant,
      characterWebResearchGrantState: definitions!.characterWebResearchGrantState,
      call: {
        name: CHARACTER_WEB_SEARCH_TOOL_NAME,
        arguments: JSON.stringify({ maxResults: 4 }),
        function: { name: CHARACTER_WEB_SEARCH_TOOL_NAME, arguments: JSON.stringify({ maxResults: 4 }) },
      },
    });

    expect(calls).toEqual([
      {
        chatId: "chat-1",
        grantId: "grant-1",
        query: "current lunar eclipse date",
        maxResults: 4,
      },
    ]);
  });

  it("distinguishes expired consent from a missing runtime integration", async () => {
    const expiredResult = await executeMainToolCall({
      deps: { storage: storageWithCustomTools(), integrations },
      input: runtimeInput({ characterWebAccessEnabled: true }),
      customTools: new Map(),
      allowedToolNames: new Set(),
      characterWebResearchGrant: null,
      characterWebResearchGrantState: "expired",
      call: {
        name: CHARACTER_WEB_SEARCH_TOOL_NAME,
        arguments: "{}",
        function: { name: CHARACTER_WEB_SEARCH_TOOL_NAME, arguments: "{}" },
      },
    });
    expect(JSON.parse(expiredResult).error.code).toBe("character_web_grant_expired");

    const metadata = {
      characterWebAccessEnabled: true,
      characterWebResearchGrant: {
        id: "grant-1",
        query: "current lunar eclipse date",
        allowedDomains: [],
        requestMessageId: "message-1",
        grantedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:05:00.000Z",
      },
    };
    const definitions = await buildMainToolDefinitions({
      chat: chat(metadata),
      storage: storageWithCustomTools(),
      integrations,
    });
    const integrationResult = await executeMainToolCall({
      deps: { storage: storageWithCustomTools(), integrations },
      input: runtimeInput(metadata),
      customTools: definitions!.customTools,
      allowedToolNames: definitions!.allowedToolNames,
      characterWebResearchGrant: definitions!.characterWebResearchGrant,
      characterWebResearchGrantState: definitions!.characterWebResearchGrantState,
      call: {
        name: CHARACTER_WEB_SEARCH_TOOL_NAME,
        arguments: "{}",
        function: { name: CHARACTER_WEB_SEARCH_TOOL_NAME, arguments: "{}" },
      },
    });
    expect(JSON.parse(integrationResult).error.code).toBe("character_web_integration_unavailable");
  });
});
