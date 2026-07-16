import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectionCatalogApi, type AvailableConnectionSummary } from "./connection-catalog-api";
import { localSidecarApi } from "./local-sidecar-api";
import { storageApi } from "./storage-api";

vi.mock("./local-sidecar-api", () => ({
  localSidecarApi: {
    status: vi.fn(),
  },
}));

vi.mock("./storage-api", () => ({
  storageApi: {
    list: vi.fn(),
  },
}));

function readySidecarStatus() {
  return {
    status: "ready",
    configured: true,
    enabled: true,
    ready: true,
    baseUrl: "http://127.0.0.1:3333",
    modelDownloaded: true,
    config: {
      enabled: true,
      executablePath: null,
      model: "local-model.gguf",
    },
    runtime: { installed: true },
  } as unknown as Awaited<ReturnType<typeof localSidecarApi.status>>;
}

const storedConnection: AvailableConnectionSummary = {
  id: "stored-text",
  name: "Stored text",
  provider: "openai",
};

describe("connectionCatalogApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageApi.list).mockResolvedValue([storedConnection]);
    vi.mocked(localSidecarApi.status).mockResolvedValue(readySidecarStatus());
  });

  it("combines a ready Local Model with stored connections", async () => {
    await expect(connectionCatalogApi.listAvailable()).resolves.toEqual([
      expect.objectContaining({
        id: "sidecar:local",
        name: "Local Model",
        provider: "custom",
        synthetic: true,
      }),
      storedConnection,
    ]);
  });

  it("keeps a configured stored default ahead of the runtime-only fallback", () => {
    expect(
      connectionCatalogApi.selectDefaultTextConnectionId([
        { id: "sidecar:local", name: "Local Model", provider: "custom", synthetic: true },
        { ...storedConnection, isDefault: "true" },
      ]),
    ).toBe("stored-text");
  });

  it("ignores image-only connections when resolving a text default", () => {
    expect(
      connectionCatalogApi.selectDefaultTextConnectionId([
        { id: "image", name: "Image", provider: "image_generation", isDefault: true },
        { id: "sidecar:local", name: "Local Model", provider: "custom", synthetic: true },
      ]),
    ).toBe("sidecar:local");
  });

  it("does not advertise a sidecar that is not ready", async () => {
    vi.mocked(localSidecarApi.status).mockResolvedValue({
      ...readySidecarStatus(),
      status: "stopped",
      ready: false,
    });

    await expect(connectionCatalogApi.listAvailable()).resolves.toEqual([storedConnection]);
  });
});
