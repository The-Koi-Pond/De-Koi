import type { StorageGateway } from "../../engine/capabilities/storage";
import type { InstalledExtension } from "../../engine/contracts/types/extension";
import { storageApi } from "../../shared/api/storage-api";
import { createExtensionStorageApi } from "./extension-storage-api";

type ExtensionGlobal = typeof globalThis & {
  __marinaraExtensionApis?: Map<string, unknown>;
};

type ExtensionStorageSource = Pick<StorageGateway, "list" | "get" | "create" | "update" | "delete">;

type ExtensionRuntimeConsole = Pick<Console, "error" | "warn">;

type RunnableExtension = Pick<InstalledExtension, "id" | "name" | "js" | "storageNamespaceId"> & { js: string };

export type ExtensionRuntimeDeps = {
  console?: ExtensionRuntimeConsole;
  createObjectUrl?: (blob: Blob) => string;
  importModule?: (url: string) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  revokeObjectUrl?: (url: string) => void;
  storage?: ExtensionStorageSource;
};

export type RunningExtensionScript = {
  cleanup: () => void;
  execution: Promise<void>;
};

function getExtensionGlobal() {
  return globalThis as ExtensionGlobal;
}

function sanitizeExtensionSourceName(name: string) {
  return (
    name
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "extension"
  );
}

function buildExtensionModuleSource(apiKey: string, extensionName: string, js: string) {
  const sourceName = sanitizeExtensionSourceName(extensionName);
  return [
    `const marinara = globalThis.__marinaraExtensionApis?.get(${JSON.stringify(apiKey)});`,
    `if (!marinara) throw new Error("Extension API is no longer available.");`,
    `const executeExtension = function(marinara) {`,
    js,
    `};`,
    // Bind `this` to globalThis so classic-script-style extensions that rely on
    // `this === window` (e.g. for top-level `this.foo = bar` global assignment)
    // still work under module strict mode.
    `executeExtension.call(globalThis, marinara);`,
    `export {};`,
    `//# sourceURL=marinara-extension-${sourceName}.js`,
  ].join("\n");
}

function importExtensionModule(url: string) {
  return import(/* @vite-ignore */ url);
}

export function executeCustomExtensionJavaScript(
  ext: RunnableExtension,
  deps: ExtensionRuntimeDeps = {},
): RunningExtensionScript {
  const extensionCleanups: Array<() => void> = [];
  const extensionGlobal = getExtensionGlobal();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const logger = deps.console ?? console;
  const createObjectUrl = deps.createObjectUrl ?? URL.createObjectURL.bind(URL);
  const revokeObjectUrl = deps.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL);
  const importModule = deps.importModule ?? importExtensionModule;
  const extensionStorage = deps.storage ?? storageApi;
  const apiKey = `${ext.id}-${now()}-${random().toString(36).slice(2)}`;
  const prefix = "marinara-ext-js-";
  let disposed = false;
  let objectUrl: string | null = null;

  const runExtensionCleanups = () => {
    const cleanups = extensionCleanups.splice(0);
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (e) {
        logger.warn(`[Extension:${ext.name}] Cleanup error:`, e);
      }
    });
  };

  const revokeCurrentObjectUrl = () => {
    if (!objectUrl) return;
    revokeObjectUrl(objectUrl);
    objectUrl = null;
  };

  const cleanup = () => {
    disposed = true;
    revokeCurrentObjectUrl();
    extensionGlobal.__marinaraExtensionApis?.delete(apiKey);
    runExtensionCleanups();
  };

  const extensionAPI = {
    extensionId: ext.id,
    extensionName: ext.name,

    // Inject CSS with auto-cleanup
    addStyle: (css: string) => {
      const style = document.createElement("style");
      style.id = `${prefix}style-${ext.id}-${now()}`;
      style.textContent = css;
      document.head.appendChild(style);
      extensionCleanups.push(() => style.remove());
      return style;
    },

    // Inject DOM element with auto-cleanup
    addElement: (parent: Element | string, tag: string, attrs?: Record<string, string>) => {
      const target = typeof parent === "string" ? document.querySelector(parent) : parent;
      if (!target) return null;
      const el = document.createElement(tag);
      if (attrs) {
        Object.entries(attrs).forEach(([k, v]) => {
          if (k === "innerHTML") el.innerHTML = v;
          else if (k === "textContent") el.textContent = v;
          else el.setAttribute(k, v);
        });
      }
      target.appendChild(el);
      extensionCleanups.push(() => el.remove());
      return el;
    },

    storage: createExtensionStorageApi(extensionStorage, ext.storageNamespaceId ?? ext.id),

    // addEventListener with auto-cleanup
    on: (target: EventTarget, event: string, handler: EventListenerOrEventListenerObject) => {
      target.addEventListener(event, handler);
      extensionCleanups.push(() => target.removeEventListener(event, handler));
    },

    // setInterval with auto-cleanup
    setInterval: (fn: () => void, ms: number) => {
      const id = window.setInterval(fn, ms);
      extensionCleanups.push(() => window.clearInterval(id));
      return id;
    },

    // setTimeout with auto-cleanup
    setTimeout: (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      extensionCleanups.push(() => window.clearTimeout(id));
      return id;
    },

    // MutationObserver with auto-cleanup
    observe: (target: Element | string, callback: MutationCallback, options?: MutationObserverInit) => {
      const el = typeof target === "string" ? document.querySelector(target) : target;
      if (!el) return null;
      const observer = new MutationObserver(callback);
      observer.observe(el, options || { childList: true, subtree: true });
      extensionCleanups.push(() => observer.disconnect());
      return observer;
    },

    // Register a cleanup function manually
    onCleanup: (fn: () => void) => {
      if (disposed) {
        fn();
        return;
      }
      extensionCleanups.push(fn);
    },
  };

  const moduleSource = buildExtensionModuleSource(apiKey, ext.name, ext.js);
  const blob = new Blob([moduleSource], { type: "text/javascript" });
  objectUrl = createObjectUrl(blob);

  extensionGlobal.__marinaraExtensionApis ??= new Map();
  extensionGlobal.__marinaraExtensionApis.set(apiKey, extensionAPI);

  const execution = importModule(objectUrl)
    .catch((e) => {
      if (!disposed) {
        logger.error(`[Extension:${ext.name}] Failed to execute:`, e);
        runExtensionCleanups();
      }
    })
    .finally(() => {
      revokeCurrentObjectUrl();
      extensionGlobal.__marinaraExtensionApis?.delete(apiKey);
    });

  return { cleanup, execution };
}
