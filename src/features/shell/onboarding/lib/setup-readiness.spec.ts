import { describe, expect, it } from "vitest";
import { buildSetupReadinessFacts } from "./setup-readiness";

const language = { id: "language", provider: "openai", model: "gpt" };

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
    ["https://runtime.test", { status: "not-writable", message: "Read only", health: { ok: true, writable: false } }, "error"],
  ] as const)("maps web runtime %s / %s", (runtimeUrl, runtimeHealth, expected) => {
    expect(buildSetupReadinessFacts({ embedded: false, runtimeUrl, runtimeHealth, connections: [] }).runtimeHealth).toBe(expected);
  });

  it("does not count image or TTS-only connections as language readiness", () => {
    expect(buildSetupReadinessFacts({
      embedded: true,
      connections: [{ id: "image", provider: "image_generation" }, { id: "tts", provider: "tts" }],
    }).usableConnectionCount).toBe(0);
  });

  it("accepts a saved usable language connection when provider testing is unavailable", () => {
    expect(buildSetupReadinessFacts({
      embedded: true,
      connections: [language],
      selectedConnectionId: "language",
      connectionTestCapability: "unavailable",
    }).selectedConnectionTest).toBe("passed");
  });
});
