import { afterEach, describe, expect, it, vi } from "vitest";

import { legacyMemoryId, sha256MemoryId } from "./deterministic-memory-id";

describe("deterministic memory ids", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("separates identities that collide under the legacy 32-bit hash", async () => {
    const first = "2\u001fchat-1\u001fsource-47759";
    const second = "2\u001fchat-1\u001fsource-364162";

    expect(legacyMemoryId("memory-capture", first)).toBe("memory-capture-e207dea7");
    expect(legacyMemoryId("memory-capture", second)).toBe("memory-capture-e207dea7");
    await expect(sha256MemoryId("memory-capture", first)).resolves.not.toBe(
      await sha256MemoryId("memory-capture", second),
    );
  });

  it("keeps SHA-256 ids available without Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined);

    await expect(sha256MemoryId("test", "abc")).resolves.toBe(
      "test-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
