import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeTauri } from "./tauri-client";
import { remoteRuntimeTarget } from "./remote-runtime";
import { fontsApi } from "./settings-assets-api";

vi.mock("./tauri-client", () => ({ invokeTauri: vi.fn() }));
vi.mock("./remote-runtime", () => ({ remoteRuntimeTarget: vi.fn() }));

describe("fonts API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(remoteRuntimeTarget).mockReturnValue(null);
  });

  it("encodes a bounded font file for the shared runtime command", async () => {
    vi.mocked(invokeTauri).mockResolvedValue({ family: "Example" } as never);
    const file = new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x01])], "Example.woff2", {
      type: "font/woff2",
      lastModified: 7,
    });

    await fontsApi.upload(file);

    expect(invokeTauri).toHaveBeenCalledWith("fonts_upload", {
      body: {
        file: expect.objectContaining({
          name: "Example.woff2",
          type: "font/woff2",
          size: 5,
          lastModified: 7,
          base64: "d09GMgE=",
        }),
      },
    });
  });

  it("reports whether the active client can open the runtime font folder", () => {
    expect(fontsApi.canOpenFolder()).toBe(true);
    vi.mocked(remoteRuntimeTarget).mockReturnValue({ baseUrl: "https://pi.example" });
    expect(fontsApi.canOpenFolder()).toBe(false);
  });
});
