import { beforeEach, describe, expect, it, vi } from "vitest";

import { KNOWLEDGE_SOURCE_UPLOAD_SIZE_ERROR, MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES } from "./file-payload";
import { knowledgeSourcesApi } from "./integration-utility-api";
import { invokeTauri } from "./tauri-client";

vi.mock("./tauri-client", () => ({
  invokeTauri: vi.fn(),
}));

function fakeFile(size: number, bytes = [0x6d, 0x61, 0x72, 0x69]) {
  let arrayBufferCalls = 0;
  const file = {
    name: "knowledge.txt",
    type: "text/plain",
    size,
    async arrayBuffer() {
      arrayBufferCalls += 1;
      return new Uint8Array(bytes).buffer;
    },
  } as File;

  return {
    file,
    arrayBufferCalls: () => arrayBufferCalls,
  };
}

describe("knowledgeSourcesApi.upload", () => {
  beforeEach(() => {
    vi.mocked(invokeTauri).mockReset();
  });

  it("rejects oversized knowledge files before reading or invoking storage", async () => {
    const upload = fakeFile(MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES + 1);

    await expect(knowledgeSourcesApi.upload(upload.file)).rejects.toThrow(KNOWLEDGE_SOURCE_UPLOAD_SIZE_ERROR);

    expect(upload.arrayBufferCalls()).toBe(0);
    expect(invokeTauri).not.toHaveBeenCalled();
  });

  it("uploads knowledge files within the configured size limit", async () => {
    const upload = fakeFile(4);
    vi.mocked(invokeTauri).mockResolvedValue({ id: "source-1" });

    await expect(knowledgeSourcesApi.upload(upload.file)).resolves.toEqual({ id: "source-1" });

    expect(upload.arrayBufferCalls()).toBe(1);
    expect(invokeTauri).toHaveBeenCalledWith("knowledge_source_upload", {
      body: {
        file: {
          name: "knowledge.txt",
          type: "text/plain",
          size: 4,
          base64: "bWFyaQ==",
        },
      },
    });
  });
});
