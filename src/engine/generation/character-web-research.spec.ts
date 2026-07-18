import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import {
  activateAlwaysAllowedCharacterWebResearch,
  characterWebResearchApprovalPatch,
  createCharacterWebResearchGrant,
} from "./character-web-research";

describe("character web research approval", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("releases a previous auto-grant before activating the next exact query", async () => {
    let previousReleased = false;
    const patches: Record<string, unknown>[] = [];
    const storage = {
      async list() {
        return [];
      },
      async patchChatMetadata(_chatId: string, patch: Record<string, unknown>) {
        if (!previousReleased) throw new Error("new grant was written before the previous grant released");
        patches.push(patch);
        return {};
      },
    } as unknown as StorageGateway;

    const activated = await activateAlwaysAllowedCharacterWebResearch({
      storage,
      integrations: {} as IntegrationGateway,
      chat: {
        id: "chat-1",
        mode: "conversation",
        metadata: {
          characterWebAccessEnabled: true,
          characterWebResearchPolicy: "always",
        },
      },
      requestMessageId: "tool-call-2",
      query: "current meteor shower forecast",
      releasePrevious: async () => {
        previousReleased = true;
      },
      id: "grant-3",
      now: new Date("2099-07-18T20:00:00.000Z"),
    });

    expect(previousReleased).toBe(true);
    expect(patches).toEqual([{ characterWebResearchGrant: activated.grant }]);
  });

  it("logs non-content request context when automatic activation fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      activateAlwaysAllowedCharacterWebResearch({
        storage: {
          async list() {
            return [];
          },
          async patchChatMetadata() {
            throw new Error("storage unavailable");
          },
        } as unknown as StorageGateway,
        integrations: {} as IntegrationGateway,
        chat: {
          id: "chat-1",
          mode: "conversation",
          metadata: {
            characterWebAccessEnabled: true,
            characterWebResearchPolicy: "always",
          },
        },
        requestMessageId: "tool-call-3",
        query: "private user query",
        id: "grant-4",
      }),
    ).rejects.toThrow("storage unavailable");

    expect(warning).toHaveBeenCalledWith(
      "[character-web-research] automatic grant activation failed",
      expect.objectContaining({
        chatId: "chat-1",
        requestMessageId: "tool-call-3",
        queryLength: "private user query".length,
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private user query");
  });

  it("does not persist a new grant when rebuilding the bounded tools fails", async () => {
    const patches: Record<string, unknown>[] = [];

    await expect(
      activateAlwaysAllowedCharacterWebResearch({
        storage: {
          async list() {
            throw new Error("tool loading failed");
          },
          async patchChatMetadata(_chatId: string, patch: Record<string, unknown>) {
            patches.push(patch);
            return {};
          },
        } as unknown as StorageGateway,
        integrations: {} as IntegrationGateway,
        chat: {
          id: "chat-1",
          mode: "conversation",
          metadata: {
            characterWebAccessEnabled: true,
            characterWebResearchPolicy: "always",
          },
        },
        requestMessageId: "tool-call-4",
        query: "current aurora forecast",
        id: "grant-5",
        now: new Date("2099-07-18T20:00:00.000Z"),
      }),
    ).rejects.toThrow("tool loading failed");

    expect(patches).toEqual([]);
  });
});
