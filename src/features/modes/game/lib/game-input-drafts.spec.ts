import { describe, expect, it } from "vitest";
import { createGameInputDraftStore, type GameInputAttachment, type GameInputDraftStorage } from "./game-input-drafts";

class MemoryStorage implements GameInputDraftStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const attachment = (name: string): GameInputAttachment => ({
  type: "image/png",
  data: `data:image/png;base64,${name}`,
  name,
});

describe("game input draft store", () => {
  it("isolates each chat and persists only text and safe scalar state", () => {
    const storage = new MemoryStorage();
    const drafts = createGameInputDraftStore({ storage });

    drafts.setText("chat-a", "A text");
    drafts.setQueuedDice("chat-a", "d20");
    drafts.setAddressMode("chat-a", "gm");
    drafts.addAttachment("chat-a", attachment("a.png"));

    drafts.setText("chat-b", "B text");
    drafts.setQueuedDice("chat-b", "2d6");
    drafts.setAddressMode("chat-b", "party");
    drafts.addAttachment("chat-b", attachment("b.png"));

    expect(drafts.read("chat-a")).toEqual({
      text: "A text",
      queuedDice: "d20",
      addressMode: "gm",
      attachments: [attachment("a.png")],
    });
    expect(drafts.read("chat-b")).toEqual({
      text: "B text",
      queuedDice: "2d6",
      addressMode: "party",
      attachments: [attachment("b.png")],
    });

    const afterRemount = createGameInputDraftStore({ storage });
    expect(afterRemount.read("chat-a")).toEqual({
      text: "A text",
      queuedDice: "d20",
      addressMode: "gm",
      attachments: [],
    });
    expect(afterRemount.hasUnsavedMemoryWork()).toBe(false);
  });

  it("routes late file reads to the chat that started them", () => {
    const drafts = createGameInputDraftStore({ storage: new MemoryStorage() });

    const read = drafts.beginAttachmentRead("chat-a");
    drafts.setText("chat-b", "now active");
    read.complete(attachment("late.png"));

    expect(drafts.read("chat-a").attachments).toEqual([attachment("late.png")]);
    expect(drafts.read("chat-b").attachments).toEqual([]);
    expect(drafts.hasUnsavedMemoryWork()).toBe(true);
  });

  it("counts pending reads as unsaved memory work and releases cancelled reads", () => {
    const drafts = createGameInputDraftStore({ storage: new MemoryStorage() });

    const read = drafts.beginAttachmentRead("chat-a");
    expect(drafts.hasUnsavedMemoryWork()).toBe(true);

    read.cancel();
    expect(drafts.hasUnsavedMemoryWork()).toBe(false);
  });

  it("clears only the submitted chat after success and retains it after failure", () => {
    const drafts = createGameInputDraftStore({ storage: new MemoryStorage() });
    drafts.setText("chat-a", "send A");
    drafts.setQueuedDice("chat-a", "d20");
    drafts.addAttachment("chat-a", attachment("a.png"));
    drafts.setText("chat-b", "keep B");
    drafts.setQueuedDice("chat-b", "d6");
    drafts.addAttachment("chat-b", attachment("b.png"));

    const failed = drafts.captureSubmission("chat-a");
    drafts.completeSubmission(failed, false);
    expect(drafts.read("chat-a").text).toBe("send A");

    const succeeded = drafts.captureSubmission("chat-a");
    drafts.completeSubmission(succeeded, true);

    expect(drafts.read("chat-a")).toEqual({
      text: "",
      queuedDice: null,
      addressMode: "scene",
      attachments: [],
    });
    expect(drafts.read("chat-b")).toEqual({
      text: "keep B",
      queuedDice: "d6",
      addressMode: "scene",
      attachments: [attachment("b.png")],
    });
  });

  it("does not erase edits added to the origin chat while its send is pending", () => {
    const drafts = createGameInputDraftStore({ storage: new MemoryStorage() });
    drafts.setText("chat-a", "send this");
    drafts.setQueuedDice("chat-a", "d20");
    drafts.addAttachment("chat-a", attachment("sent.png"));
    const submission = drafts.captureSubmission("chat-a");

    drafts.setText("chat-a", "new draft");
    drafts.setQueuedDice("chat-a", "d6");
    drafts.addAttachment("chat-a", attachment("new.png"));
    drafts.completeSubmission(submission, true);

    expect(drafts.read("chat-a")).toEqual({
      text: "new draft",
      queuedDice: "d6",
      addressMode: "scene",
      attachments: [attachment("new.png")],
    });
  });

  it("clears only consumed text after a quick reply succeeds", () => {
    const drafts = createGameInputDraftStore({ storage: new MemoryStorage() });
    drafts.setText("chat-a", "include this");
    drafts.setQueuedDice("chat-a", "d20");
    drafts.addAttachment("chat-a", attachment("keep.png"));
    const submission = drafts.captureSubmission("chat-a");

    drafts.completeTextSubmission(submission, true);

    expect(drafts.read("chat-a")).toEqual({
      text: "",
      queuedDice: "d20",
      addressMode: "scene",
      attachments: [attachment("keep.png")],
    });
  });
});
