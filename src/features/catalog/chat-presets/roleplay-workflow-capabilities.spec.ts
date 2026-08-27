import { describe, expect, it } from "vitest";

import { resolveRoleplayWorkflowImageCapability } from "./roleplay-workflow-capabilities";

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
