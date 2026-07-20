import { describe, expect, it, vi } from "vitest";

import { createEphemeralAttachmentDraftOwner } from "./ephemeral-attachment-drafts";

const alpha = { type: "image/png", data: "data:image/png;base64,alpha", name: "alpha.png" };
const beta = { type: "text/plain", data: "data:text/plain;base64,beta", name: "beta.txt" };

describe("ephemeral attachment draft owner", () => {
  it("keeps drafts isolated by mode and chat across view lifecycles", () => {
    const owner = createEphemeralAttachmentDraftOwner();

    owner.replace("roleplay", "chat-a", [alpha]);
    owner.replace("roleplay", "chat-b", [beta]);
    owner.replace("conversation", "chat-a", [beta]);

    expect(owner.read("roleplay", "chat-a")).toEqual([alpha]);
    expect(owner.read("roleplay", "chat-b")).toEqual([beta]);
    expect(owner.read("conversation", "chat-a")).toEqual([beta]);

    // A new view reads the same owner after the previous view has gone away.
    expect(owner.read("roleplay", "chat-a")).toEqual([alpha]);
  });

  it("routes a late attachment to its originating inactive chat", () => {
    const owner = createEphemeralAttachmentDraftOwner();
    const changed = vi.fn();
    const unsubscribe = owner.subscribe(changed);

    owner.append("roleplay", "chat-a", alpha);
    owner.append("roleplay", "chat-b", beta);

    expect(owner.read("roleplay", "chat-a")).toEqual([alpha]);
    expect(owner.read("roleplay", "chat-b")).toEqual([beta]);
    expect(changed).toHaveBeenCalledWith("roleplay", "chat-a");

    unsubscribe();
    owner.append("roleplay", "chat-a", beta);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("clears only the submitted chat and tracks reads as pending work", () => {
    const owner = createEphemeralAttachmentDraftOwner();
    owner.replace("roleplay", "chat-a", [alpha]);
    owner.replace("roleplay", "chat-b", [beta]);
    owner.adjustPendingReads("roleplay", "chat-c", 1);

    owner.clear("roleplay", "chat-a");

    expect(owner.read("roleplay", "chat-a")).toEqual([]);
    expect(owner.read("roleplay", "chat-b")).toEqual([beta]);
    expect(owner.hasPendingWork("roleplay")).toBe(true);

    owner.adjustPendingReads("roleplay", "chat-c", -1);
    owner.clear("roleplay", "chat-b");
    expect(owner.hasPendingWork("roleplay")).toBe(false);
  });

  it("never writes attachment payloads to browser storage", () => {
    const owner = createEphemeralAttachmentDraftOwner();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    owner.replace("roleplay", "chat-a", [alpha]);
    owner.append("roleplay", "chat-a", beta);

    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
