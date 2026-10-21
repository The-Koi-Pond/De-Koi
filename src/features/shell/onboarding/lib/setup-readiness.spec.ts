import { describe, expect, it } from "vitest";
import { buildSetupReadinessFacts } from "./setup-readiness";

const language = { id: "language", provider: "openai", model: "gpt", hasApiKey: true };

describe("buildSetupReadinessFacts", () => {
  it("omits runtime requirements for the embedded desktop", () => {
    expect(buildSetupReadinessFacts({ embedded: true, connections: [language] })).toMatchObject({
      environment: "embedded",
      runtimeHealth: "not-required",
      usableConnectionCount: 1,
    });
  });

  it.each([
    ["", undefined, "unknown"],
    ["https://runtime.test", { status: "checking", message: "Checking" }, "unknown"],
    ["https://runtime.test", { status: "ok", message: "Ready", health: { ok: true, writable: true } }, "healthy"],
    [
      "https://runtime.test",
      { status: "not-writable", message: "Read only", health: { ok: true, writable: false } },
      "error",
    ],
  ] as const)("maps web runtime %s / %s", (runtimeUrl, runtimeHealth, expected) => {
    expect(
      buildSetupReadinessFacts({ embedded: false, runtimeUrl, runtimeHealth, connections: [] }).runtimeHealth,
    ).toBe(expected);
  });

  it("does not count image or TTS-only connections as language readiness", () => {
    expect(
      buildSetupReadinessFacts({
        embedded: true,
        connections: [
          { id: "image", provider: "image_generation" },
          { id: "tts", provider: "tts" },
        ],
      }).usableConnectionCount,
    ).toBe(0);
  });

  it("counts a saved usable connection without transient test metadata", () => {
    expect(buildSetupReadinessFacts({ embedded: true, connections: [language] }).usableConnectionCount).toBe(1);
  });

  // A connection made without a key has no model yet and can't reply, but it used to count as "connected" and hide
  // the Add a model connection step.
  it("does not count a connection that has no model picked yet", () => {
    expect(
      buildSetupReadinessFacts({
        embedded: true,
        connections: [
          { id: "new", provider: "openrouter", model: "" },
          { id: "blank", provider: "openai", model: "   " },
          { id: "missing", provider: "anthropic", hasApiKey: true },
        ],
      }).usableConnectionCount,
    ).toBe(0);
  });

  // The create dialog pre-fills a default model for providers like OpenAI, so a model alone isn't proof.
  it("does not count a key-based connection that has no key saved", () => {
    expect(
      buildSetupReadinessFacts({
        embedded: true,
        connections: [{ id: "keyless", provider: "openai", model: "gpt-5", hasApiKey: false }],
      }).usableConnectionCount,
    ).toBe(0);
  });

  it("counts subscription and custom connections that need no saved key", () => {
    expect(
      buildSetupReadinessFacts({
        embedded: true,
        connections: [
          { id: "claude", provider: "claude_subscription", model: "claude-opus-5-5", hasApiKey: false },
          { id: "chatgpt", provider: "openai_chatgpt", model: "gpt-5", hasApiKey: false },
          { id: "local", provider: "custom", model: "llama", hasApiKey: false },
        ],
      }).usableConnectionCount,
    ).toBe(3);
  });
});
