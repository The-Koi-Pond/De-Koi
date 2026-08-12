import { describe, expect, it } from "vitest";

import { createChatSchema } from "./chat.schema";

describe("createChatSchema", () => {
  it("does not add background agents to new chats", () => {
    expect(createChatSchema.parse({ name: "Roleplay", mode: "roleplay" })).not.toHaveProperty("metadata");
    expect(createChatSchema.parse({ name: "Conversation", mode: "conversation" })).not.toHaveProperty("metadata");
    expect(createChatSchema.parse({ name: "Game", mode: "game" })).not.toHaveProperty("metadata");
  });
});
