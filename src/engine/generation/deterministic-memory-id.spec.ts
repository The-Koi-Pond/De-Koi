import { describe, expect, it } from "vitest";

import { legacyMemoryId, sha256MemoryId } from "./deterministic-memory-id";

describe("deterministic memory ids", () => {
  it("separates identities that collide under the legacy 32-bit hash", async () => {
    const first = "2\u001fchat-1\u001fsource-47759";
    const second = "2\u001fchat-1\u001fsource-364162";

    expect(legacyMemoryId("memory-capture", first)).toBe("memory-capture-e207dea7");
    expect(legacyMemoryId("memory-capture", second)).toBe("memory-capture-e207dea7");
    await expect(sha256MemoryId("memory-capture", first)).resolves.not.toBe(
      await sha256MemoryId("memory-capture", second),
    );
  });
});
