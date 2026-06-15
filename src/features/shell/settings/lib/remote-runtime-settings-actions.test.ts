import { describe, expect, it } from "vitest";
import {
  initialRemoteRuntimeHealth,
  remoteRuntimeHealthDotTone,
  remoteRuntimeHealthErrorView,
} from "./remote-runtime-settings-actions";

describe("remote runtime settings actions", () => {
  it("uses the unconfigured health state for blank URLs", () => {
    expect(initialRemoteRuntimeHealth("   ")).toMatchObject({ status: "unconfigured" });
  });

  it("uses idle health before a configured URL is visible", () => {
    expect(initialRemoteRuntimeHealth("http://127.0.0.1:8787")).toEqual({
      status: "idle",
      message: "Status checks when this section is visible.",
    });
  });

  it("maps thrown health failures to unreachable state", () => {
    expect(remoteRuntimeHealthErrorView(new Error("connection refused"))).toEqual({
      status: "unreachable",
      message: "connection refused",
    });
  });

  it("keeps each health status on the expected dot tone", () => {
    expect(remoteRuntimeHealthDotTone("ok")).toBe("ok");
    expect(remoteRuntimeHealthDotTone("checking")).toBe("checking");
    expect(remoteRuntimeHealthDotTone("not-writable")).toBe("warning");
    expect(remoteRuntimeHealthDotTone("invalid")).toBe("error");
    expect(remoteRuntimeHealthDotTone("unreachable")).toBe("error");
    expect(remoteRuntimeHealthDotTone("idle")).toBe("idle");
    expect(remoteRuntimeHealthDotTone("unconfigured")).toBe("idle");
  });
});
