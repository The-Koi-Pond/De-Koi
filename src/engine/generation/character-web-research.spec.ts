import { describe, expect, it } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import {
  activateAlwaysAllowedCharacterWebResearch,
  characterWebResearchApprovalPatch,
  createCharacterWebResearchGrant,
} from "./character-web-research";

describe("character web research approval", () => {
  it("stores the durable chat policy only for always approval", () => {
    const grant = createCharacterWebResearchGrant({
      id: "grant-1",
      now: new Date("2099-07-18T20:00:00.000Z"),
      requestMessageId: "message-1",
      query: "current lunar eclipse date",
      allowedDomains: ["nasa.gov"],
    });

    expect(characterWebResearchApprovalPatch("once", grant)).toEqual({
      characterWebResearchGrant: grant,
    });
    expect(characterWebResearchApprovalPatch("always", grant)).toEqual({
      characterWebResearchPolicy: "always",
      characterWebResearchGrant: grant,
    });
  });

  it("turns an always-approved future request into a fresh exact-query grant and bounded web tools", async () => {
    const patches: Record<string, unknown>[] = [];
    const storage = {
      async list() {
        return [];
      },
      async patchChatMetadata(_chatId: string, patch: Record<string, unknown>) {
        patches.push(patch);
        return {};
      },
    } as unknown as StorageGateway;
    const chat = {
      id: "chat-1",
      mode: "conversation",
      metadata: {
        characterWebAccessEnabled: true,
        characterWebResearchPolicy: "always",
      },
    };

    const activated = await activateAlwaysAllowedCharacterWebResearch({
      storage,
      integrations: {} as IntegrationGateway,
      chat,
      requestMessageId: "tool-call-1",
      query: "current lunar eclipse date",
      allowedDomains: ["nasa.gov"],
      id: "grant-2",
      now: new Date("2099-07-18T20:00:00.000Z"),
    });

    expect(patches).toEqual([{ characterWebResearchGrant: activated.grant }]);
    expect(activated.grant).toMatchObject({
      id: "grant-2",
      query: "current lunar eclipse date",
      requestMessageId: "tool-call-1",
    });
    expect(activated.mainTools.toolDefs.map((tool) => tool.name)).toEqual([
      "search_character_web",
      "read_character_web_page",
    ]);

    await activated.release();
    expect(patches).toEqual([{ characterWebResearchGrant: activated.grant }, { characterWebResearchGrant: null }]);
  });
});
