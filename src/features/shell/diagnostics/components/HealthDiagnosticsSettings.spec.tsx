import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionCommandApi } from "../../../../shared/api/connection-command-api";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { HealthDiagnosticsSettings } from "./HealthDiagnosticsSettings";

vi.mock("../../../../shared/api/remote-runtime", async () => {
  const actual = await vi.importActual<typeof import("../../../../shared/api/remote-runtime")>(
    "../../../../shared/api/remote-runtime",
  );
  return {
    ...actual,
    hasEmbeddedTauriRuntime: () => true,
    checkRemoteRuntimeHealth: vi.fn(),
  };
});

vi.mock("../../../../shared/api/local-sidecar-api", () => ({
  localSidecarApi: {
    status: vi.fn(),
    testMessage: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/connection-command-api", () => ({
  connectionCommandApi: {
    test: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    list: vi.fn(),
  },
}));

vi.mock("../../../../shared/lib/client-diagnostics", () => ({
  getRecentClientDiagnostics: vi.fn(() => [
    {
      id: "recent-1",
      level: "warning",
      source: "remote-runtime",
      message: "Remote runtime returned 503.",
      timestamp: "2026-06-22T20:00:00.000Z",
    },
  ]),
  recordClientDiagnostic: vi.fn(),
}));

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("HealthDiagnosticsSettings", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    vi.mocked(localSidecarApi.status).mockResolvedValue({
      id: "sidecar:local",
      status: "ready",
      configured: true,
      enabled: true,
      config: {
        enabled: true,
        executablePath: null,
        modelPath: null,
        model: "local-sidecar",
        contextSize: 4096,
        maxTokens: 512,
        temperature: 0.7,
        topP: 1,
        topK: 40,
        gpuLayers: 0,
        quantization: "q4_k_m",
        customModelRepo: null,
        runtimePreference: "auto",
      },
      ready: true,
      baseUrl: "http://127.0.0.1:3333",
      logPath: "C:\\Users\\celia\\AppData\\Roaming\\De-Koi\\sidecar.log",
      startupError: null,
      modelDownloaded: true,
      modelDisplayName: "Gemma Q4",
      modelSize: 123,
      runtime: {
        installed: true,
        build: "test",
        variant: "cpu",
        backend: "llama_cpp",
        source: "bundled",
        systemPath: null,
        serverPath: "C:\\Users\\celia\\runtime\\llama-server.exe",
      },
      platform: "windows",
      arch: "x64",
      curatedModels: [],
      download: null,
    });
    vi.mocked(localSidecarApi.testMessage).mockResolvedValue({
      success: true,
      response: "pong",
      nonceVerified: true,
      latencyMs: 12,
    });
    vi.mocked(connectionCommandApi.test).mockResolvedValue({ success: true, latencyMs: 10 });
    vi.mocked(storageApi.list).mockImplementation(async (entity) => {
      if (entity === "connections") {
        return [
          {
            id: "conn-1",
            name: "Main Model",
            provider: "openai",
            model: "gpt-test",
            baseUrl: "https://api.example.test/v1",
          },
        ];
      }
      return [];
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("renders the dashboard and does not run explicit probes on load", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthDiagnosticsSettings />);
    });
    await flushAsyncWork();

    expect(container!.textContent).toContain("Health and Diagnostics");
    expect(container!.textContent).toContain("Runtime");
    expect(container!.textContent).toContain("Local Model");
    expect(container!.textContent).toContain("Providers");
    expect(container!.textContent).toContain("Storage");
    expect(container!.textContent).toContain("Recent Diagnostics");
    expect(container!.textContent).toContain("Troubleshooting Packet");
    expect(container!.textContent).toContain("Main Model");
    expect(localSidecarApi.status).toHaveBeenCalledTimes(1);
    expect(localSidecarApi.testMessage).not.toHaveBeenCalled();
    expect(connectionCommandApi.test).not.toHaveBeenCalled();
  });

  it("runs sidecar smoke tests and provider probes only from explicit buttons", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthDiagnosticsSettings />);
    });
    await flushAsyncWork();

    const buttons = Array.from(container!.querySelectorAll("button"));
    const smokeButton = buttons.find((button) => button.textContent?.includes("Run smoke test"));
    const probeButton = buttons.find((button) => button.textContent?.includes("Probe"));
    expect(smokeButton).toBeTruthy();
    expect(probeButton).toBeTruthy();

    await act(async () => {
      smokeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncWork();
    expect(localSidecarApi.testMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      probeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncWork();
    expect(connectionCommandApi.test).toHaveBeenCalledWith("conn-1");
  });

  it("clears provider attention status after a successful explicit probe", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthDiagnosticsSettings />);
    });
    await flushAsyncWork();

    expect(container!.textContent).toContain("Needs attention");

    const probeButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Probe"),
    );
    expect(probeButton).toBeTruthy();

    await act(async () => {
      probeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncWork();

    expect(connectionCommandApi.test).toHaveBeenCalledWith("conn-1");
    expect(container!.textContent).toContain("Probe completed in 10 ms.");
    expect(container!.textContent).not.toContain("Needs attention");
  });

  it("summarizes the failing diagnostic in the top status detail", async () => {
    vi.mocked(storageApi.list).mockImplementation(async (entity) => {
      if (entity === "connections") {
        return [
          {
            id: "conn-1",
            name: "Main Model",
            provider: "openai",
            model: "gpt-test",
            baseUrl: "https://api.example.test/v1",
          },
        ];
      }
      if (entity === "chats") {
        throw new Error("Storage unavailable");
      }
      return [];
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthDiagnosticsSettings />);
    });
    await flushAsyncWork();

    const statusDetail = Array.from(container!.querySelectorAll("span")).find((span) =>
      span.textContent?.includes("Snapshot generated"),
    );

    expect(statusDetail?.textContent).toContain("Storage");
    expect(statusDetail?.textContent).toContain("Chats");
    expect(statusDetail?.textContent).toContain("Storage unavailable");
  });
});
