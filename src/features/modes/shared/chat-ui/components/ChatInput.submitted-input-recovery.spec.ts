import { describe, expect, it } from "vitest";

import { getSubmittedInputFailureAction, mergeSubmittedInputForRestore } from "./ChatInput";

describe("submitted chat input recovery", () => {
  it("merges a rejected submission ahead of a newer draft without duplicating attachments", () => {
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
    const restored = mergeSubmittedInputForRestore(
      { text: "Original submission", attachments: [submittedAttachment] },
      { text: "Newer draft", attachments: [submittedAttachment, newerAttachment] },
    );

    expect(restored).toEqual({
      text: "Original submission\n\nNewer draft",
      attachments: [submittedAttachment, newerAttachment],
    });
  });

  it("restores an aborted submission that was not accepted", () => {
    const error = new Error("Stopped");
    error.name = "AbortError";

    expect(getSubmittedInputFailureAction(error, false)).toEqual({ restore: true, report: false });
  });

  it("does not restore an aborted submission after acceptance", () => {
    const error = new Error("Stopped");
    error.name = "AbortError";

    expect(getSubmittedInputFailureAction(error, true)).toEqual({ restore: false, report: false });
  });
});
