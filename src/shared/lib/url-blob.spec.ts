import { describe, expect, it } from "vitest";

import { blobToDataUrl } from "./url-blob";

describe("blobToDataUrl", () => {
  it("encodes binary larger than one base64 chunk without FileReader", async () => {
    expect(typeof (globalThis as { FileReader?: unknown }).FileReader).toBe("undefined");
    const bytes = Uint8Array.from({ length: 100_003 }, (_, index) => (index * 31) % 256);

    await expect(blobToDataUrl(new Blob([bytes], { type: "image/webp" }))).resolves.toBe(
      `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`,
    );
  });

  it("matches FileReader's octet-stream type for untyped and empty blobs", async () => {
    await expect(blobToDataUrl(new Blob([new Uint8Array([1, 2, 3])]))).resolves.toBe(
      "data:application/octet-stream;base64,AQID",
    );
    await expect(blobToDataUrl(new Blob([]))).resolves.toBe("data:application/octet-stream;base64,");
  });
});
