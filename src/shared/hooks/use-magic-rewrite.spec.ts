import { beforeEach, describe, expect, it, vi } from "vitest";

import { llmApi } from "../api/llm-api";
import { localSidecarApi } from "../api/local-sidecar-api";
import { storageApi } from "../api/storage-api";
import { useMagicRewrite } from "./use-magic-rewrite";

vi.mock("react", () => ({
  useEffect: vi.fn(),
  useState: vi.fn((initial: unknown) => [typeof initial === "function" ? "" : initial, vi.fn()]),
}));

vi.mock("../api/llm-api", () => ({
  llmApi: {
    complete: vi.fn(),
  },
}));

vi.mock("../api/local-sidecar-api", () => ({
  localSidecarApi: {
    status: vi.fn(),
  },
}));

vi.mock("../api/storage-api", () => ({
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

describe("useMagicRewrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageApi.list).mockResolvedValue([]);
    vi.mocked(localSidecarApi.status).mockResolvedValue(readySidecarStatus());
    vi.mocked(llmApi.complete).mockResolvedValue("Rewritten text");
  });

  it("uses a ready Local Model when no stored text connection exists", async () => {
    const rewrite = useMagicRewrite("Source text");

    await rewrite.generate();

    expect(localSidecarApi.status).toHaveBeenCalledOnce();
    expect(llmApi.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "sidecar:local",
      }),
    );
  });
});
