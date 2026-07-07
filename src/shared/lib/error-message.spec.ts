import { describe, expect, it } from "vitest";

import { getErrorMessage, toUserMessage } from "./error-message";

describe("user-facing error messages", () => {
  it("uses contextual copy instead of raw exception text", () => {
    const message = toUserMessage(new Error("invoke failed: status 500 at /api/invoke"), "importChat");

    expect(message).toBe("Couldn't import that chat file. Pick another file or try again.");
  });

  it("keeps getErrorMessage as a human fallback helper", () => {
    const message = getErrorMessage(new Error("AxiosError: Request failed with status code 500"), "Couldn't save.");

    expect(message).toBe("Couldn't save.");
  });
});
