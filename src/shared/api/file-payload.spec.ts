import { afterEach, describe, expect, it, vi } from "vitest";
import { fileToUploadPayload } from "./file-payload";

describe("fileToUploadPayload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes upload bytes in bounded chunks", async () => {
    const originalBtoa = globalThis.btoa;
    const chunkSizes: number[] = [];
    vi.stubGlobal("btoa", (value: string) => {
      chunkSizes.push(value.length);
      return originalBtoa(value);
    });

    const bytes = new Uint8Array(80_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    const file = new File([bytes], "chat.jsonl", {
      type: "application/jsonl",
      lastModified: 123,
    });

    const payload = await fileToUploadPayload(file);

    expect(payload).toMatchObject({
      name: "chat.jsonl",
      type: "application/jsonl",
      size: bytes.length,
      lastModified: 123,
    });
    expect(payload.base64).toBe(originalBtoa(String.fromCharCode(...bytes)));
    expect(chunkSizes.length).toBeGreaterThan(1);
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(32_768);
  });
});
