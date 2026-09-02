import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "../../../engine/contracts/types/chat";

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
  listStorage: vi.fn(),
  listConnections: vi.fn(),
  listBackgrounds: vi.fn(),
  getModuleSettings: vi.fn(),
  getTtsConfig: vi.fn(),
  getSidecarStatus: vi.fn(),
}));

vi.mock("../../../shared/api/storage-api", () => ({
  storageApi: { get: mocks.getStorage, list: mocks.listStorage },
}));

vi.mock("../../../shared/api/connection-catalog-api", () => ({
  connectionCatalogApi: { listAvailable: mocks.listConnections },
}));

vi.mock("../../../shared/api/settings-assets-api", () => ({
  backgroundsApi: { list: mocks.listBackgrounds },
}));

vi.mock("../../../shared/api/core-modules-api", () => ({
  coreModulesApi: { settings: { get: mocks.getModuleSettings } },
}));

vi.mock("../../../shared/api/tts-api", () => ({
  ttsApi: { config: mocks.getTtsConfig },
}));

vi.mock("../../../shared/api/local-sidecar-api", () => ({
  localSidecarApi: { status: mocks.getSidecarStatus },
}));

import {
  resolveRoleplayWorkflowCapabilities,
  resolveRoleplayWorkflowImageCapability,
} from "./roleplay-workflow-capabilities";

const connections = [
  { id: "local", name: "Local Images", provider: "image_generation", baseUrl: "http://127.0.0.1:8188" },
  {
    id: "cloud",
    name: "Cloud Images",
    provider: "image_generation",
    baseUrl: "https://images.example.com",
    defaultForAgents: true,
  },
] as const;

const roleplayChat: Chat = {
  id: "roleplay-1",
  name: "Roleplay",
  mode: "roleplay",
  characterIds: [],
  groupId: null,
  personaId: null,
  promptPresetId: null,
  connectionId: null,
  connectedChatId: null,
  folderId: null,
  sortOrder: 0,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  metadata: {
    summary: null,
    tags: [],
    agentOverrides: {},
    activeAgentIds: [],
    activeToolIds: [],
    presetChoices: {},
  },
};

describe("resolveRoleplayWorkflowImageCapability", () => {
  it("matches Illustrator runtime precedence across agent, chat, and global defaults", () => {
    expect(
      resolveRoleplayWorkflowImageCapability({
        chat: { metadata: { illustrationImageConnectionId: "cloud" } },
        agents: [{ id: "illustrator", type: "illustrator", settings: { imageConnectionId: "local" } }],
        connections,
      }),
    ).toEqual({ label: "Local Images", mayUsePaidOrExternalService: false });

    expect(
      resolveRoleplayWorkflowImageCapability({
        chat: { metadata: { illustrationImageConnectionId: "local" } },
        agents: [{ id: "illustrator", type: "illustrator", settings: {} }],
        connections,
      }),
    ).toEqual({ label: "Local Images", mayUsePaidOrExternalService: false });

    expect(resolveRoleplayWorkflowImageCapability({ chat: { metadata: {} }, agents: [], connections })).toEqual({
      label: "Cloud Images",
      mayUsePaidOrExternalService: true,
    });
  });

  it("does not claim a fallback connection when the runtime-selected id is dangling", () => {
    expect(
      resolveRoleplayWorkflowImageCapability({
        chat: { metadata: { illustrationImageConnectionId: "deleted-connection" } },
        agents: [],
        connections,
      }),
    ).toBeNull();
  });
});

describe("resolveRoleplayWorkflowCapabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getStorage.mockImplementation(async (collection: string, id: string) => {
      if (collection === "prompts") return { id };
      return null;
    });
    mocks.listStorage.mockResolvedValue([]);
    mocks.listConnections.mockResolvedValue(connections);
    mocks.listBackgrounds.mockResolvedValue([{ filename: "forest.png" }]);
    mocks.getModuleSettings.mockResolvedValue({ enabled: {} });
    mocks.getTtsConfig.mockResolvedValue({ enabled: true, baseUrl: "http://127.0.0.1:5002", voice: "local" });
    mocks.getSidecarStatus.mockResolvedValue(null);
  });

  it("keeps ordinary workflow profiles available when remote sidecar status requires admin access", async () => {
    mocks.getSidecarStatus.mockRejectedValue(new Error("This remote command requires ADMIN_SECRET on the runtime."));

    await expect(resolveRoleplayWorkflowCapabilities(roleplayChat)).resolves.toMatchObject({
      hasUniversalPreset: true,
      localSidecarReady: false,
      hasImageConnection: true,
      hasUsableBackgroundAssets: true,
      ttsReady: true,
    });
  });

  it("still surfaces failures from required workflow capability reads", async () => {
    mocks.getStorage.mockRejectedValueOnce(new Error("Prompt catalog unavailable"));

    await expect(resolveRoleplayWorkflowCapabilities(roleplayChat)).rejects.toThrow("Prompt catalog unavailable");
  });
});
