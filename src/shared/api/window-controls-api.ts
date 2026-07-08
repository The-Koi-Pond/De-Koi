import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type TauriRuntimeWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

type CurrentWindow = ReturnType<typeof getCurrentWindow>;

type DesktopCloseRequestedEvent = {
  preventDefault: () => void;
};

export type DesktopWindowVisualState = {
  fullscreen: boolean;
  maximized: boolean;
};

const WINDOWED_STATE: DesktopWindowVisualState = {
  fullscreen: false,
  maximized: false,
};
let allowNextClose = false;
let allowNextCloseResetTimer: number | null = null;

function resetAllowNextClose() {
  allowNextClose = false;
  if (allowNextCloseResetTimer !== null) {
    window.clearTimeout(allowNextCloseResetTimer);
    allowNextCloseResetTimer = null;
  }
}

function armAllowNextClose() {
  allowNextClose = true;
  if (allowNextCloseResetTimer !== null) window.clearTimeout(allowNextCloseResetTimer);
  allowNextCloseResetTimer = window.setTimeout(resetAllowNextClose, 1000);
}

function hasEmbeddedTauriWindowShell() {
  if (typeof window === "undefined") return false;
  const runtimeWindow = window as TauriRuntimeWindow;
  return Boolean(runtimeWindow.__TAURI__ || runtimeWindow.__TAURI_INTERNALS__);
}

function currentWindow(): CurrentWindow | null {
  if (!hasEmbeddedTauriWindowShell()) return null;
  return getCurrentWindow();
}

function requireCurrentWindow(): CurrentWindow {
  const appWindow = currentWindow();
  if (!appWindow) {
    throw new Error("This action requires the Tauri app shell");
  }
  return appWindow;
}

async function readVisualState(appWindow: CurrentWindow): Promise<DesktopWindowVisualState> {
  const [fullscreen, maximized] = await Promise.all([
    appWindow.isFullscreen().catch(() => false),
    appWindow.isMaximized().catch(() => false),
  ]);
  return { fullscreen, maximized };
}

export function hasDesktopWindowControls() {
  return hasEmbeddedTauriWindowShell();
}

export async function getDesktopWindowVisualState(): Promise<DesktopWindowVisualState> {
  const appWindow = currentWindow();
  if (!appWindow) return WINDOWED_STATE;
  return readVisualState(appWindow);
}

export async function minimizeDesktopWindow() {
  await requireCurrentWindow().minimize();
}

export async function closeDesktopWindow(options: { force?: boolean } = {}) {
  if (options.force) armAllowNextClose();
  try {
    await requireCurrentWindow().close();
  } catch (error) {
    if (options.force) resetAllowNextClose();
    throw error;
  }
}

export async function startDesktopWindowDrag() {
  await requireCurrentWindow().startDragging();
}

export async function toggleDesktopWindowMaximize(): Promise<DesktopWindowVisualState> {
  const appWindow = requireCurrentWindow();
  await appWindow.toggleMaximize();
  return readVisualState(appWindow);
}

export async function toggleDesktopWindowFullscreen(): Promise<DesktopWindowVisualState> {
  const appWindow = requireCurrentWindow();
  const wasFullscreen = await appWindow.isFullscreen().catch(() => false);
  const fullscreen = !wasFullscreen;
  await appWindow.setFullscreen(fullscreen);
  const state = await readVisualState(appWindow);
  return { ...state, fullscreen };
}

export async function onDesktopWindowVisualStateChanged(handler: () => void): Promise<UnlistenFn> {
  const appWindow = currentWindow();
  if (!appWindow) return () => {};

  const unlisteners = await Promise.all([appWindow.onResized(() => handler()), appWindow.onMoved(() => handler())]);

  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

export async function onDesktopWindowCloseRequested(
  handler: () => void | Promise<void>,
  shouldPreventClose: () => boolean = () => true,
): Promise<UnlistenFn> {
  const appWindow = currentWindow();
  if (!appWindow) return () => {};

  return appWindow.onCloseRequested((event: DesktopCloseRequestedEvent) => {
    if (allowNextClose) {
      resetAllowNextClose();
      return;
    }
    if (!shouldPreventClose()) return;
    event.preventDefault();
    void handler();
  });
}