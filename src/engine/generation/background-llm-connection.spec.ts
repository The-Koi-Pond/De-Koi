import { describe, expect, it } from "vitest";

import { selectBackgroundTextConnection } from "./background-llm-connection";

describe("selectBackgroundTextConnection", () => {
  const foreground = { id: "foreground", provider: "nanogpt", model: "glm-5.2", enabled: true };
  const agent = {
    id: "background",
    provider: "openai",
    model: "gpt-5-mini",
    enabled: true,
    defaultForAgents: "true",
  };
  const defaultConnection = {
    id: "default",
    provider: "openai",
    model: "gpt-5",
    enabled: true,
    isDefault: true,
  };

  it("prefers the dedicated agent connection over the foreground fallback", () => {
    expect(selectBackgroundTextConnection([foreground, agent, defaultConnection], "foreground")?.id).toBe("background");
  });

  it("uses the foreground fallback when no dedicated agent connection exists", () => {
    expect(selectBackgroundTextConnection([defaultConnection, foreground], "foreground")?.id).toBe("foreground");
  });

  it("preserves a synthetic foreground fallback that is not stored as a connection", () => {
    expect(selectBackgroundTextConnection([], "local-sidecar", "local-model")).toEqual({
      id: "local-sidecar",
      model: "local-model",
    });
  });

  it("falls back to the default text connection and excludes disabled or image connections", () => {
    expect(
      selectBackgroundTextConnection([
        { ...agent, id: "disabled-agent", enabled: false },
        { ...agent, id: "image-agent", provider: "image_generation" },
        defaultConnection,
      ])?.id,
    ).toBe("default");
  });
});
