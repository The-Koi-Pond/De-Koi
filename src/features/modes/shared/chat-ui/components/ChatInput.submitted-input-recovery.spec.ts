import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ephemeralAttachmentDrafts } from "../../../../../shared/lib/ephemeral-attachment-drafts";
import {
  getSubmittedInputFailureAction,
  mergeSubmittedInputForRestore,
  resolveSubmittedInputFailure,
  restoreInactiveSubmittedAttachmentDraft,
  type SubmittedInputRecoverySource,
} from "./ChatInput";

const ALTERNATE_SUBMISSION_SOURCES: SubmittedInputRecoverySource[] = ["typed-slash", "quick-slash", "post-only"];

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

  it.each(ALTERNATE_SUBMISSION_SOURCES)(
    "restores an aborted %s submission ahead of a newer draft without reporting or duplicate attachments",
    (source) => {
      const error = new Error("Stopped");
      error.name = "AbortError";
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

      expect(
        resolveSubmittedInputFailure({
          source,
          error,
          userMessageAccepted: false,
          submitted: { text: "Submitted", attachments: [submittedAttachment] },
          current: { text: "Newer", attachments: [submittedAttachment, newerAttachment] },
        }),
      ).toEqual({
        source,
        restore: true,
        report: false,
        restored: {
          text: "Submitted\n\nNewer",
          attachments: [submittedAttachment, newerAttachment],
        },
      });
    },
  );

  it.each(ALTERNATE_SUBMISSION_SOURCES)("restores and reports a non-abort %s failure", (source) => {
    expect(
      resolveSubmittedInputFailure({
        source,
        error: new Error("Failed"),
        userMessageAccepted: false,
        submitted: { text: "Submitted", attachments: [] },
        current: { text: "Newer", attachments: [] },
      }),
    ).toMatchObject({ source, restore: true, report: true, restored: { text: "Submitted\n\nNewer" } });
  });

  it("does not restore Post-only text when rollback failed and saved data may remain", () => {
    expect(
      resolveSubmittedInputFailure({
        source: "post-only",
        error: new Error("Attachment failed"),
        userMessageAccepted: false,
        savedDataMayRemain: true,
        submitted: { text: "Submitted", attachments: [] },
        current: { text: "Newer", attachments: [] },
      }),
    ).toEqual({
      source: "post-only",
      restore: false,
      report: true,
      restored: null,
    });
  });

  it.each(ALTERNATE_SUBMISSION_SOURCES)("routes the %s callsite through the shared recovery seam", (source) => {
    const chatInputSource = readFileSync(
      join(process.cwd(), "src/features/modes/shared/chat-ui/components/ChatInput.tsx"),
      "utf8",
    );
    expect(chatInputSource).toMatch(new RegExp(`recoverSubmittedInput\\(\\s*"${source}"`));
  });

  it("restores an inactive chat into the durable in-memory owner used by the next view", () => {
    const submitted = { type: "image/png", data: "data:image/png;base64,submitted", name: "submitted.png" };
    const newer = { type: "image/png", data: "data:image/png;base64,newer", name: "newer.png" };
    ephemeralAttachmentDrafts.replace("roleplay", "inactive-chat", [newer]);

    restoreInactiveSubmittedAttachmentDraft("roleplay", "inactive-chat", [submitted]);

    expect(ephemeralAttachmentDrafts.read("roleplay", "inactive-chat")).toEqual([submitted, newer]);
  });
});
