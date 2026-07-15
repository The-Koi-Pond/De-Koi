import type { InstalledExtension } from "../../engine/contracts/types/extension";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCustomExtensionJavaScript, type ExtensionRuntimeDeps } from "./extension-runtime";

type TestGlobal = typeof globalThis & {
  __extensionCleanupHits?: number;
  __extensionIntervalHits?: number;
  __extensionListenerHits?: number;
  __extensionRan?: boolean;
  __marinaraExtensionApis?: Map<string, unknown>;
};

type TestStorage = NonNullable<ExtensionRuntimeDeps["storage"]>;
type RunnableTestExtension = InstalledExtension & { js: string };

function createExtension(
  overrides: Partial<Omit<InstalledExtension, "js">> & { js?: string } = {},
): RunnableTestExtension {
  const { js = "", ...rest } = overrides;
  return {
    id: "ext-test",
    name: "Test Extension",
    description: "Test extension",
    js,
    css: null,
    enabled: true,
    installedAt: "2026-06-17T00:00:00.000Z",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    ...rest,
  };
}

function createStorageStub(): TestStorage {
  return {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  };
}

function createDataUrlModuleLoader() {
  const blobs = new Map<string, Blob>();
  const revokedUrls: string[] = [];
  let nextUrlId = 0;

  const deps = {
    createObjectUrl: vi.fn((blob: Blob) => {
      const url = `blob:test-extension-${nextUrlId}`;
      nextUrlId += 1;
      blobs.set(url, blob);
      return url;
    }),
    importModule: vi.fn(async (url: string) => {
      const blob = blobs.get(url);
      if (!blob) throw new Error(`Missing blob for ${url}`);
      const source = await blob.text();
      await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
    }),
    revokeObjectUrl: vi.fn((url: string) => {
      revokedUrls.push(url);
      blobs.delete(url);
    }),
  };

  return { blobs, deps, revokedUrls };
}

function testGlobal() {
  return globalThis as TestGlobal;
}

describe("custom extension runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete testGlobal().__extensionCleanupHits;
    delete testGlobal().__extensionIntervalHits;
    delete testGlobal().__extensionListenerHits;
    delete testGlobal().__extensionRan;
    delete testGlobal().__marinaraExtensionApis;
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete testGlobal().__extensionCleanupHits;
    delete testGlobal().__extensionIntervalHits;
    delete testGlobal().__extensionListenerHits;
    delete testGlobal().__extensionRan;
    delete testGlobal().__marinaraExtensionApis;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("executes enabled JavaScript through the extension API and cleans up runtime handles", async () => {
    const loader = createDataUrlModuleLoader();
    const ext = createExtension({
      js: `
        globalThis.__extensionRan = true;
        globalThis.__extensionListenerHits = 0;
        globalThis.__extensionIntervalHits = 0;
        globalThis.__extensionCleanupHits = 0;
        marinara.addStyle(".extension-runtime-proof { color: red; }");
        marinara.addElement(document.body, "div", { id: "extension-runtime-node", textContent: marinara.extensionId });
        marinara.on(window, "extension-runtime-proof", () => {
          globalThis.__extensionListenerHits += 1;
        });
        marinara.setInterval(() => {
          globalThis.__extensionIntervalHits += 1;
        }, 10);
        marinara.onCleanup(() => {
          globalThis.__extensionCleanupHits += 1;
        });
      `,
    });

    const running = executeCustomExtensionJavaScript(ext, {
      ...loader.deps,
      now: () => 123,
      random: () => 0.5,
      storage: createStorageStub(),
    });

    expect(testGlobal().__marinaraExtensionApis?.size).toBe(1);

    await running.execution;

    expect(testGlobal().__extensionRan).toBe(true);
    expect(testGlobal().__marinaraExtensionApis?.size).toBe(0);
    expect(document.head.querySelector("style")?.textContent).toContain(".extension-runtime-proof");
    expect(document.getElementById("extension-runtime-node")?.textContent).toBe(ext.id);

    window.dispatchEvent(new Event("extension-runtime-proof"));
    expect(testGlobal().__extensionListenerHits).toBe(1);

    vi.advanceTimersByTime(35);
    expect(testGlobal().__extensionIntervalHits).toBeGreaterThanOrEqual(3);

    running.cleanup();
    const intervalHitsAfterCleanup = testGlobal().__extensionIntervalHits;

    expect(document.head.querySelector("style")).toBeNull();
    expect(document.getElementById("extension-runtime-node")).toBeNull();
    expect(testGlobal().__extensionCleanupHits).toBe(1);
    expect(testGlobal().__marinaraExtensionApis?.size).toBe(0);

    window.dispatchEvent(new Event("extension-runtime-proof"));
    vi.advanceTimersByTime(35);

    expect(testGlobal().__extensionListenerHits).toBe(1);
    expect(testGlobal().__extensionIntervalHits).toBe(intervalHitsAfterCleanup);
    expect(loader.revokedUrls).toEqual(["blob:test-extension-0"]);
  });

  it("removes the global extension API entry when cleaned up before module loading settles", async () => {
    const importStarted = vi.fn();
    let resolveImport!: () => void;
    const importPending = new Promise<void>((resolve) => {
      resolveImport = resolve;
    });
    const ext = createExtension({
      js: `globalThis.__extensionRan = true;`,
    });

    const running = executeCustomExtensionJavaScript(ext, {
      createObjectUrl: () => "blob:pending-extension",
      importModule: async () => {
        importStarted();
        await importPending;
      },
      revokeObjectUrl: vi.fn(),
      storage: createStorageStub(),
    });

    expect(importStarted).toHaveBeenCalledTimes(1);
    expect(testGlobal().__marinaraExtensionApis?.size).toBe(1);

    running.cleanup();

    expect(testGlobal().__marinaraExtensionApis?.size).toBe(0);

    resolveImport();
    await running.execution;

    expect(testGlobal().__marinaraExtensionApis?.size).toBe(0);
    expect(testGlobal().__extensionRan).toBeUndefined();
  });

  it("exposes only declared De-Koi helpers to package extensions", () => {
    const running = executeCustomExtensionJavaScript(
      createExtension({ source: "package", manifestVersion: 1, permissions: ["ui:styles"] }),
      {
        createObjectUrl: () => "blob:filtered-extension",
        importModule: () => new Promise(() => undefined),
        revokeObjectUrl: vi.fn(),
        storage: createStorageStub(),
      },
    );
    const api = [...(testGlobal().__marinaraExtensionApis?.values() ?? [])][0] as Record<string, unknown>;

    expect(api.addStyle).toBeTypeOf("function");
    expect(api.storage).toBeUndefined();
    expect(api.addElement).toBeUndefined();
    running.cleanup();
  });

  it("preserves the legacy helper surface for file extensions", () => {
    const running = executeCustomExtensionJavaScript(createExtension({ source: "file" }), {
      createObjectUrl: () => "blob:legacy-extension",
      importModule: () => new Promise(() => undefined),
      revokeObjectUrl: vi.fn(),
      storage: createStorageStub(),
    });
    const api = [...(testGlobal().__marinaraExtensionApis?.values() ?? [])][0] as Record<string, unknown>;

    expect(api.addStyle).toBeTypeOf("function");
    expect(api.storage).toBeDefined();
    expect(api.addElement).toBeTypeOf("function");
    running.cleanup();
  });
});
