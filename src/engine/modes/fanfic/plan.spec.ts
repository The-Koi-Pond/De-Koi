import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import { fanficChapterTextKey } from "./ledger";
import {
  applyFanficPlan,
  clearFanficPlan,
  fanficPlanNotes,
  parseFanficPlanReply,
  proposeFanficPlan,
  readFanficPlan,
} from "./plan";
import { createFanficState, defaultFanficRequest } from "./request";

const request = { ...defaultFanficRequest(), fandom: "The Freak Circus", characters: ["Harlequin"], chapterCount: 4 };
const outline = {
  title: "Collection",
  summary: "",
  chapters: [
    { number: 1, title: "Terms", summary: "They set a safe word." },
    { number: 2, title: "Free Use", summary: "He finds her everywhere." },
    { number: 3, title: "The Word", summary: "She uses the safe word." },
    { number: 4, title: "After", summary: "They make up." },
  ],
};
const approved: FanficState = { ...createFanficState(request), outline, outlineApproved: true };
const chapters = ["They never set a safe word. He laughed instead.", "Pierrot stabbed him with a tent stake."];

function storageWith(state: FanficState, written: string[]) {
  const chat: Record<string, unknown> = {
    id: "chat-1",
    mode: "fanfic",
    connectionId: "conn-1",
    metadata: { fanfic: state },
  };
  const messages = written.map((content, index) => ({ id: `m${index + 1}`, role: "assistant", content }));
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return chat as T;
      if (entity === "connections") return { id, provider: "claude_subscription" } as T;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async patchChatMetadata<T = unknown>(_id: string, patch: Record<string, unknown>): Promise<T> {
      chat.metadata = { ...(chat.metadata as object), ...patch };
      return chat as T;
    },
  } as unknown as StorageGateway;
  return { storage, chat, messages };
}

function scriptedLlm(reply: string) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (llmRequest: LlmRequest) => {
      requests.push(llmRequest);
      return reply;
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

const replanReply = JSON.stringify({
  note: "No safe word was ever set, so chapter 3 sets one first.",
  chapters: [
    {
      number: 3,
      title: "The Word",
      summary: "He gives her a word, then finds the line she won't cross.",
      keep: false,
      reason: "No word was set.",
    },
    { number: 4, title: "ignored", summary: "ignored", keep: true, reason: "" },
  ],
});

describe("parseFanficPlanReply", () => {
  it("needs a plan for every remaining chapter and copies kept ones exactly", () => {
    const parsed = parseFanficPlanReply(replanReply, outline, [3, 4]);
    expect(parsed.chapters[0]).toMatchObject({ number: 3, changed: true, reason: "No word was set." });
    expect(parsed.chapters[0]!.previous).toEqual({ title: "The Word", summary: "She uses the safe word." });
    expect(parsed.chapters[1]).toMatchObject({ number: 4, title: "After", summary: "They make up.", changed: false });
    expect(() => parseFanficPlanReply(replanReply, outline, [3, 4, 5])).toThrow(/no plan for chapter 5/);
  });
});

describe("proposeFanficPlan", () => {
  it("re-plans the remaining chapters from what was written and stores the suggestion without touching the outline", async () => {
    const { storage, chat } = storageWith(approved, chapters);
    const { llm, requests } = scriptedLlm(replanReply);

    const proposal = await proposeFanficPlan({ storage, llm }, { chatId: "chat-1", steer: "Bring Pierrot back." });

    expect(proposal).toMatchObject({ mode: "replan", afterChapter: 2, steer: "Bring Pierrot back." });
    const [system, user] = requests[0]!.messages;
    expect(system!.content).toContain("Re-plan chapters 3 to 4");
    expect(system!.content).toContain("## The outline as planned");
    expect(user!.content).toContain("Pierrot stabbed him with a tent stake.");
    expect(user!.content).toContain("## The requester's steer\nBring Pierrot back.");
    const metadata = chat.metadata as Record<string, unknown>;
    expect((metadata.fanfic as FanficState).outline).toEqual(outline);
    expect(
      readFanficPlan(
        metadata,
        chapters.map((content) => ({ content })),
      ),
    ).toMatchObject({ afterChapter: 2 });

    // Using it changes only the remaining chapters.
    const used = applyFanficPlan(approved, proposal);
    expect(used.outline!.chapters.map((chapter) => chapter.summary)).toEqual([
      "They set a safe word.",
      "He finds her everywhere.",
      "He gives her a word, then finds the line she won't cross.",
      "They make up.",
    ]);

    await clearFanficPlan(storage, "chat-1");
    expect(
      readFanficPlan(
        chat.metadata,
        chapters.map((content) => ({ content })),
      ),
    ).toBeNull();
  });

  it("goes stale when a chapter is added or rewritten", async () => {
    const { storage, chat } = storageWith(approved, chapters);
    const { llm } = scriptedLlm(replanReply);
    await proposeFanficPlan({ storage, llm }, { chatId: "chat-1" });
    expect(
      readFanficPlan(
        chat.metadata,
        [...chapters, "Chapter three."].map((content) => ({ content })),
      ),
    ).toBeNull();
    expect(
      readFanficPlan(
        chat.metadata,
        [chapters[0]!, "Rewritten."].map((content) => ({ content })),
      ),
    ).toBeNull();
    // Editing the outline makes it stale too.
    const metadata = chat.metadata as Record<string, unknown>;
    const refs = chapters.map((content) => ({ content }));
    expect(readFanficPlan(metadata, refs)).not.toBeNull();
    const edited: FanficState = {
      ...approved,
      outline: {
        ...outline,
        chapters: outline.chapters.map((chapter) =>
          chapter.number === 4 ? { ...chapter, summary: "Edited." } : chapter,
        ),
      },
    };
    expect(readFanficPlan({ ...metadata, fanfic: edited }, refs)).toBeNull();
  });

  it("past the outline, suggests the next chapter as notes", async () => {
    const oneShot: FanficState = {
      ...createFanficState({ ...request, chapterCount: 1 }),
      outline: { ...outline, chapters: [outline.chapters[0]!] },
      outlineApproved: true,
    };
    const { storage } = storageWith(oneShot, chapters);
    const { llm, requests } = scriptedLlm(
      JSON.stringify({
        note: "The last chapters all stayed in bed.",
        chapters: [
          { number: 3, title: "Props Wagon", summary: "He breaks the wagon rule.", keep: false, reason: "New ground." },
        ],
      }),
    );

    const proposal = await proposeFanficPlan({ storage, llm }, { chatId: "chat-1" });

    expect(proposal.mode).toBe("next");
    expect(requests[0]!.messages[0]!.content).toContain("Plan chapter 3 so it follows");
    expect(fanficPlanNotes(proposal)).toBe("Props Wagon: He breaks the wagon rule.");
    expect(applyFanficPlan(oneShot, proposal)).toBe(oneShot);
  });

  it("needs an approved outline and a written chapter", async () => {
    const { llm } = scriptedLlm(replanReply);
    await expect(
      proposeFanficPlan({ storage: storageWith(approved, []).storage, llm }, { chatId: "chat-1" }),
    ).rejects.toThrow(/Write the first chapter/);
    await expect(
      proposeFanficPlan(
        { storage: storageWith({ ...approved, outlineApproved: false }, chapters).storage, llm },
        { chatId: "chat-1" },
      ),
    ).rejects.toThrow(/Approve the outline/);
  });
});

it("keys freshness on the last chapter's text", () => {
  expect(fanficChapterTextKey("a")).not.toBe(fanficChapterTextKey("b"));
});
