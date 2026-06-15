import { describe, expect, it } from "vitest";

import { chatMetadataStorageApi, chatTranscriptStorageApi } from "./storage-api";

describe("focused storage ports", () => {
  it("exposes chat transcript behavior without generic collection CRUD", () => {
    expect(Object.keys(chatTranscriptStorageApi).sort()).toEqual([
      "addChatMessageSwipe",
      "createChatMessage",
      "deleteChatMessage",
      "evictPromptSnapshots",
      "getChatMessage",
      "listChatMessages",
      "patchChatMessageExtra",
      "resolveImageAttachmentDataUrl",
      "updateChatMessage",
      "updateChatMessageContentIfUnchanged",
    ]);
    expect("list" in chatTranscriptStorageApi).toBe(false);
    expect("get" in chatTranscriptStorageApi).toBe(false);
    expect("create" in chatTranscriptStorageApi).toBe(false);
    expect("update" in chatTranscriptStorageApi).toBe(false);
    expect("delete" in chatTranscriptStorageApi).toBe(false);
  });

  it("exposes chat metadata patching without generic collection CRUD", () => {
    expect(Object.keys(chatMetadataStorageApi).sort()).toEqual(["patchChatMetadata", "patchChatSummaries"]);
    expect("list" in chatMetadataStorageApi).toBe(false);
    expect("get" in chatMetadataStorageApi).toBe(false);
    expect("create" in chatMetadataStorageApi).toBe(false);
    expect("update" in chatMetadataStorageApi).toBe(false);
    expect("delete" in chatMetadataStorageApi).toBe(false);
  });
});
