import { describe, expect, it } from "vitest";

import { createSubmittedInputRecoveryHarness } from "./submitted-input-recovery";

type Draft = {
  text: string;
  attachments: Array<{ type: string; data: string; name: string }>;
};

const submittedAttachment = {
  type: "image/png",
  data: "data:image/png;base64,submitted",
  name: "submitted.png",
};
const newerAttachment = {
  type: "image/png",
  data: "data:image/png;base64,newer",
  name: "newer.png",
};

function createOwners({
  activeChatId = "origin-chat",
  visible = { text: "Newer visible draft", attachments: [submittedAttachment, newerAttachment] },
  inactive = { text: "Newer inactive draft", attachments: [newerAttachment] },
}: {
  activeChatId?: string;
  visible?: Draft;
  inactive?: Draft;
} = {}) {
  const state = {
    activeChatId,
    visible: { text: visible.text, attachments: [...visible.attachments] },
    inactive: { text: inactive.text, attachments: [...inactive.attachments] },
    persistedText: "",
  };
  const owners: Parameters<typeof createSubmittedInputRecoveryHarness>[0] = {
    readCurrent: (chatId) => ({
      visible: state.activeChatId === chatId,
      draft: state.activeChatId === chatId ? state.visible : state.inactive,
    }),
    restoreVisible: (_chatId, restored) => {
      state.visible = { text: restored.text, attachments: [...restored.attachments] };
    },
    restoreInactive: (_chatId, restored) => {
      state.inactive = { text: restored.text, attachments: [...restored.attachments] };
    },
    persistText: (_chatId, text) => {
      state.persistedText = text;
    },
  };
  return { state, recover: createSubmittedInputRecoveryHarness(owners) };
}

function abortError() {
  const error = new Error("Stopped");
  error.name = "AbortError";
  return error;
}

describe("submitted chat input recovery", () => {
  it("restores a typed slash abort ahead of a newer visible draft and deduplicates attachments", () => {
    const { state, recover } = createOwners();
    const submission = recover.generation({
      chatId: "origin-chat",
      text: "/guided Submitted",
      attachments: [submittedAttachment],
    });

    const result = submission.failure(abortError());

    expect(result).toEqual({ restore: true, report: false });
    expect(state.visible).toEqual({
      text: "/guided Submitted\n\nNewer visible draft",
      attachments: [submittedAttachment, newerAttachment],
    });
    expect(state.persistedText).toBe("/guided Submitted\n\nNewer visible draft");
  });

  it("does not restore a quick slash abort after its user message was accepted", () => {
    const { state, recover } = createOwners();
    const submission = recover.generation({
      chatId: "origin-chat",
      text: "Quick command draft",
      attachments: [],
    });
    submission.markUserMessageAccepted();

    const result = submission.failure(abortError());

    expect(result).toEqual({ restore: false, report: false });
    expect(state.visible.text).toBe("Newer visible draft");
    expect(state.persistedText).toBe("");
  });

  it("restores a quick slash abort to inactive origin text and attachment owners", () => {
    const { state, recover } = createOwners({ activeChatId: "new-chat" });
    const submission = recover.generation({
      chatId: "origin-chat",
      text: "Quick command draft",
      attachments: [submittedAttachment],
    });

    const result = submission.failure(abortError());

    expect(result).toEqual({ restore: true, report: false });
    expect(state.inactive).toEqual({
      text: "Quick command draft\n\nNewer inactive draft",
      attachments: [submittedAttachment, newerAttachment],
    });
    expect(state.persistedText).toBe("Quick command draft\n\nNewer inactive draft");
  });

  it("restores and reports a non-abort Post-only failure after a clean rollback", () => {
    const { state, recover } = createOwners();
    const submission = recover.postOnly({
      chatId: "origin-chat",
      text: "Posted draft",
      attachments: [submittedAttachment],
    });

    const result = submission.failure(new Error("Attachment failed"));

    expect(result).toEqual({ restore: true, report: true });
    expect(state.visible).toEqual({
      text: "Posted draft\n\nNewer visible draft",
      attachments: [submittedAttachment, newerAttachment],
    });
  });

  it("does not restore Post-only state when the submitted message rollback failed", () => {
    const { state, recover } = createOwners();
    const submission = recover.postOnly({
      chatId: "origin-chat",
      text: "Posted draft",
      attachments: [submittedAttachment],
    });
    submission.markSubmittedMessageRollbackFailed();

    const result = submission.failure(new Error("Attachment failed"));

    expect(result).toEqual({ restore: false, report: true });
    expect(state.visible.text).toBe("Newer visible draft");
    expect(state.persistedText).toBe("");
  });

  it("restores Post-only state while reporting auxiliary saved data that failed cleanup", () => {
    const { state, recover } = createOwners();
    const submission = recover.postOnly({
      chatId: "origin-chat",
      text: "Posted draft",
      attachments: [submittedAttachment],
    });
    submission.markAuxiliaryDataRollbackFailed();

    const result = submission.failure(new Error("Attachment cleanup failed"));

    expect(result).toEqual({ restore: true, report: true });
    expect(state.visible).toEqual({
      text: "Posted draft\n\nNewer visible draft",
      attachments: [submittedAttachment, newerAttachment],
    });
    expect(state.persistedText).toBe("Posted draft\n\nNewer visible draft");
  });
});
