import { describe, expect, it } from "vitest";

import { createChatSchema } from "./chat.schema";

describe("createChatSchema", () => {
  it("persists detached Narrative Craft as the default for a new roleplay chat", () => {
    expect(createChatSchema.parse({ name: "Roleplay", mode: "roleplay" })).toMatchObject({
      metadata: {
        activeAgentIds: ["narrative-craft"],
        enableAgents: true,
      },
    });
  });

  it("does not add Narrative Craft to conversation or game chats", () => {
    expect(createChatSchema.parse({ name: "Conversation", mode: "conversation" })).not.toHaveProperty("metadata");
    expect(createChatSchema.parse({ name: "Game", mode: "game" })).not.toHaveProperty("metadata");
  });
});
