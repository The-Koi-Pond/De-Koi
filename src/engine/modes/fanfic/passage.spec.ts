import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import { fanficChapterTextKey } from "./ledger";
import { applyFanficPassageRewrite, locateFanficSelection, suggestFanficPassageRewrite } from "./passage";
import { createFanficState, defaultFanficRequest } from "./request";

const request = { ...defaultFanficRequest(), fandom: "The Freak Circus", characters: ["Harlequin"] };
const chapter =
  'Harlequin points a claw at Pierrot. "Look at him. He\'s buffering." Pierrot wipes his hand on the sheet. "Bells," Harlequin says, "bells, bells."';

function storageWith(content: string) {
  const chat = {
    id: "chat-1",
    mode: "fanfic",
    connectionId: "conn-1",
    metadata: { fanfic: createFanficState(request) },
  };
  const messages = [
    { id: "m1", role: "assistant", content: "Chapter one. Bells everywhere, bells.", swipes: ["x"] },
    { id: "m2", role: "assistant", content, swipes: [content] },
  ];
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return chat as T;
      if (entity === "connections") return { id, provider: "claude_subscription" } as T;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    addChatMessageSwipe: vi.fn(async (_chatId: string, messageId: string, next: string) => {
      const message = messages.find((entry) => entry.id === messageId)!;
      message.swipes.push(next);
      message.content = next;
      return message;
    }),
  } as unknown as StorageGateway;
  return { storage, messages };
}

function scriptedLlm(replies: string[]) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (llmRequest: LlmRequest) => {
      requests.push(llmRequest);
      return replies.shift() ?? "";
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("locateFanficSelection", () => {
  it("finds the selection once, through rendered quote marks and line breaks", () => {
    const span = locateFanficSelection(chapter, "Look at him.\nHe’s buffering.");
    expect(chapter.slice(span.start, span.end)).toBe("Look at him. He's buffering.");
    // An opening quote mark at the edge of the selection comes along, curly or straight.
    const quoted = locateFanficSelection(chapter, "“Bells,” Harlequin says,");
    expect(chapter.slice(quoted.start, quoted.end)).toBe('"Bells," Harlequin says,');
    expect(() => locateFanficSelection(chapter, "bells")).toThrow(/at least a few words/);
    expect(() => locateFanficSelection(`${chapter} ${chapter}`, "Look at him. He's buffering.")).toThrow(
      /couldn't be pinned down/,
    );
  });
});

describe("passage rewrites", () => {
  it("offers versions without saving, sends earlier tries and the overused list, then saves the chosen one", async () => {
    const { storage, messages } = storageWith(chapter);
    const { llm, requests } = scriptedLlm([
      "Look at him. Wound down like a cheap music box, hm?",
      "Look at him. Somebody give the poor thing a crank.",
    ]);
    const textKey = fanficChapterTextKey(chapter);
    const input = {
      chatId: "chat-1",
      messageId: "m2",
      textKey,
      selected: "Look at him. He's buffering.",
      instruction: "No modern slang.",
    };

    const first = await suggestFanficPassageRewrite({ storage, llm }, input);
    const second = await suggestFanficPassageRewrite({ storage, llm }, { ...input, earlierTries: [first.text] });

    expect(messages[1]!.swipes).toHaveLength(1);
    expect(first.original).toBe("Look at him. He's buffering.");
    expect(requests[0]!.messages[1]!.content).toContain("## The passage to rewrite\nLook at him. He's buffering.");
    expect(requests[1]!.messages[1]!.content).toContain("Earlier tries the requester passed on");
    expect(requests[1]!.messages[1]!.content).toContain("cheap music box");

    await applyFanficPassageRewrite(storage, { chatId: "chat-1", messageId: "m2", textKey, suggestion: second });
    expect(messages[1]!.swipes).toHaveLength(2);
    expect(messages[1]!.content).toBe(chapter.replace("Look at him. He's buffering.", second.text));
  });

  it("refuses a version written for text that has changed since", async () => {
    const { storage } = storageWith(chapter);
    const { llm } = scriptedLlm(["Look at him. Wound down."]);
    const textKey = fanficChapterTextKey(chapter);
    const suggestion = await suggestFanficPassageRewrite(
      { storage, llm },
      { chatId: "chat-1", messageId: "m2", textKey, selected: "Look at him. He's buffering.", instruction: "x" },
    );
    const { storage: changed } = storageWith(`${chapter} More.`);
    await expect(
      applyFanficPassageRewrite(changed, { chatId: "chat-1", messageId: "m2", textKey, suggestion }),
    ).rejects.toThrow(/changed since then/);
  });
});
