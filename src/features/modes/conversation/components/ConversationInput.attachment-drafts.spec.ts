import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ConversationInput attachment draft ownership", () => {
  it("uses the shared cross-chat attachment owner and its app-close guard", () => {
    const inputSource = readFileSync(
      resolve(process.cwd(), "src/features/modes/conversation/components/ConversationInput.tsx"),
      "utf8",
    );
    const shellSource = readFileSync(resolve(process.cwd(), "src/app/shell/AppShell.tsx"), "utf8");

    expect(inputSource).toContain('ephemeralAttachmentDrafts.read("conversation"');
    expect(inputSource).not.toContain("pendingAttachmentDraftsRef");
    expect(shellSource).toContain('registerEphemeralAttachmentDraftAppCloseGuard("conversation")');
  });
});
