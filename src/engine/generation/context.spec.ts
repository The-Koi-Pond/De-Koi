import { describe, expect, it, vi } from "vitest";

import type { ChatMessageListOptions, ChatTranscriptPort } from "../capabilities/storage";
import { loadChatMessages } from "./context";

describe("generation context message loading", () => {
  it("requests attachment metadata needed to deliver stored images", async () => {
    let requestedOptions: ChatMessageListOptions | undefined;
    const storage = {
      listChatMessages: vi.fn(async (_chatId: string, options?: ChatMessageListOptions) => {
        requestedOptions = options;
        return [];
      }),
    } as unknown as ChatTranscriptPort;

    await loadChatMessages(storage, "chat-1");

    expect(requestedOptions?.fieldSelections?.extra).toContain("attachments");
  });
});
