import { describe, expect, it } from "vitest";

import { ModelRouteError } from "../../engine/generation/model-routing";
import { userFacingError } from "../../engine/shared/user-facing-error";
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

  it("shows provider and server errors as is, since their wording already names the fix", () => {
    const provider = Object.assign(
      new Error("Provider returned HTTP 401 Unauthorized: bad key. Check this connection's API key in Connections."),
      { code: "llm_provider_error" },
    );
    expect(toUserMessage(provider, "translateMessage")).toBe(provider.message);

    const server = Object.assign(new Error("Can't reach the De-Koi server. Check that it's running."), {
      name: "ApiError",
      details: { code: "remote_runtime_unreachable" },
    });
    expect(toUserMessage(server, { fallback: "Couldn't save." })).toBe(server.message);

    const engine = userFacingError("Pick a connection for this fic first.");
    expect(toUserMessage(engine, { fallback: "Couldn't write the outline." })).toBe(engine.message);

    const route = new ModelRouteError("summaries", "gone", "missing", "gone");
    expect(toUserMessage(route, { fallback: "Couldn't summarize." })).toBe(route.message);

    const login = Object.assign(new Error("OpenRouter didn't accept the login. Start the login again."), {
      name: "ApiError",
      details: { code: "openrouter_login_rejected" },
    });
    expect(toUserMessage(login, { fallback: "Couldn't finish the login." })).toBe(login.message);

    // Storage and other internal failures keep the contextual copy.
    const storage = Object.assign(new Error("messages/abc not found"), { details: { code: "not_found" } });
    expect(toUserMessage(storage, { fallback: "Couldn't save." })).toBe("Couldn't save.");
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
