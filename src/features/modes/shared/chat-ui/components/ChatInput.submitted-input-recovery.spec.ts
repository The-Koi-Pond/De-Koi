import { describe, expect, it } from "vitest";

import { getSubmittedInputFailureAction } from "./ChatInput";

describe("submitted chat input recovery", () => {
  it("restores an aborted submission that was not accepted", () => {
    const error = new Error("Stopped");
    error.name = "AbortError";

    expect(getSubmittedInputFailureAction(error, false)).toEqual({ restore: true, report: false });
  });

  it("does not restore an aborted submission after acceptance", () => {
    const error = new Error("Stopped");
    error.name = "AbortError";

    expect(getSubmittedInputFailureAction(error, true)).toEqual({ restore: false, report: false });
  });
});
