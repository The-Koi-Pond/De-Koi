import { afterEach, describe, expect, it } from "vitest";

import { ephemeralAttachmentDrafts } from "../../../../../shared/lib/ephemeral-attachment-drafts";
import {
  getSubmittedInputFailureAction,
  mergeSubmittedInputForRestore,
  restoreInactiveSubmittedAttachmentDraft,
} from "./ChatInput";

describe("submitted chat input recovery", () => {
  afterEach(() => ephemeralAttachmentDrafts.clear("roleplay", "inactive-chat"));

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

  it("restores an inactive chat into the durable in-memory owner used by the next view", () => {
    const submitted = { type: "image/png", data: "data:image/png;base64,submitted", name: "submitted.png" };
    const newer = { type: "image/png", data: "data:image/png;base64,newer", name: "newer.png" };
    ephemeralAttachmentDrafts.replace("roleplay", "inactive-chat", [newer]);

    restoreInactiveSubmittedAttachmentDraft("roleplay", "inactive-chat", [submitted]);

    expect(ephemeralAttachmentDrafts.read("roleplay", "inactive-chat")).toEqual([submitted, newer]);
  });
});
