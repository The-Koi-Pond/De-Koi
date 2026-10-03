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

  it("shows an outdated-server error as is, since retrying cannot fix it", () => {
    const outdated = new Error("This De-Koi server is older than the app and cannot save Deki settings safely.");
    outdated.name = "OutdatedServerError";

    expect(toUserMessage(outdated, "coreModuleToggle")).toBe(outdated.message);
    expect(toUserMessage(new Error("This De-Koi server is older than the app"), "coreModuleToggle")).toBe(
      "Couldn't update that module. Try again.",
    );
  });
});
