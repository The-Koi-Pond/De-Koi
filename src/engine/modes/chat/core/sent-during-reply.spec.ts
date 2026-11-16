import { describe, expect, it } from "vitest";
import {
  latestMessageSentDuringReply,
  messagesSentDuringReplies,
  sentDuringReplyHistoryNote,
} from "./sent-during-reply";

const user = (id: string) => ({ id, role: "user", extra: {} });
const reply = (id: string, answers?: string) => ({
  id,
  role: "assistant",
  extra: answers ? { answersUserVersion: { messageId: answers, index: 0 } } : {},
});

describe("messages sent while a reply was being written", () => {
  it("finds the texts a reply landed after but never saw", () => {
    // u2 and u3 were sent while r1 (answering u1) was being written, so r1 landed after them.
    const messages = [user("u1"), user("u2"), user("u3"), reply("r1", "u1")];
    expect([...messagesSentDuringReplies(messages)]).toEqual([["r1", 2]]);
    expect(latestMessageSentDuringReply(messages)).toBe(true);
  });

  it("needs nothing when the reply answered the latest text, or a later reply did", () => {
    expect(latestMessageSentDuringReply([user("u1"), user("u2"), reply("r1", "u2")])).toBe(false);
    expect(latestMessageSentDuringReply([user("u1"), user("u2"), reply("r1", "u1"), reply("r2", "u2")])).toBe(false);
  });

  it("leaves unanswered texts with no reply after them to the Retry button", () => {
    expect(latestMessageSentDuringReply([user("u1"), reply("r1", "u1"), user("u2")])).toBe(false);
  });

  it("ignores replies saved before replies said what they answered", () => {
    expect(latestMessageSentDuringReply([user("u1"), user("u2"), reply("r1")])).toBe(false);
  });

  it("words the prompt note for one or several texts", () => {
    expect(sentDuringReplyHistoryNote(1, "Chai")).toBe(
      "(Chai sent the message just before this one while this text was being written; this text did not answer it.)",
    );
    expect(sentDuringReplyHistoryNote(2, "Chai")).toContain("the 2 messages just before this one");
    expect(sentDuringReplyHistoryNote(0, "Chai")).toBe("");
  });
});
