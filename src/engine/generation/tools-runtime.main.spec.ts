import { describe, expect, it } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import { buildMainToolDefinitions } from "./tools-runtime";
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
});
