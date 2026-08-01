import { describe, expect, it } from "vitest";

import { isTerminalBackgroundGenerationError } from "./background-generation-error";

describe("isTerminalBackgroundGenerationError", () => {
  it.each([400, 401, 403, 404])("treats explicit HTTP %s failures as terminal", (status) => {
    expect(isTerminalBackgroundGenerationError({ status, message: "provider rejected request" })).toBe(true);
    expect(isTerminalBackgroundGenerationError(new Error(`Provider returned HTTP ${status}: invalid request`))).toBe(
      true,
    );
  });

  it.each([0, 408, 409, 429, 500, 502, 503, 504])("keeps HTTP %s failures retryable", (status) => {
    expect(isTerminalBackgroundGenerationError({ status, message: "temporary provider failure" })).toBe(false);
  });

  it("keeps unknown failures retryable", () => {
    expect(isTerminalBackgroundGenerationError(new Error("network connection reset"))).toBe(false);
  });
});
