import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MusicPlayerSourceSettings } from "./MusicPlayerSourceSettings";

const { musicApiMock, spotifyApiMock, openExternalUrlMock } = vi.hoisted(() => ({
  musicApiMock: { settings: vi.fn(), updateSettings: vi.fn() },
  spotifyApiMock: {
    status: vi.fn(),
    startSignIn: vi.fn(),
    signInStatus: vi.fn(),
    finishSignIn: vi.fn(),
    disconnect: vi.fn(),
    devices: vi.fn(),
  },
  openExternalUrlMock: vi.fn(),
}));

vi.mock("../../../../shared/api/music-api", () => ({ musicApi: musicApiMock, spotifyMusicApi: spotifyApiMock }));
vi.mock("../../../../shared/api/external-link-api", () => ({ openExternalUrl: openExternalUrlMock }));

const REDIRECT_URI = "http://127.0.0.1:8754/spotify/callback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function settings(overrides: Record<string, unknown> = {}) {
  return {
    source: "spotify",
    spotifyClientId: "",
    spotifyPreferredDeviceId: null,
    spotifyPreferredDeviceName: null,
    spotifyRedirectUri: REDIRECT_URI,
    ...overrides,
  };
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    provider: "spotify",
    enabled: true,
    selected: true,
    clientId: "",
    hasClientId: false,
    connected: false,
    renewsAutomatically: false,
    displayName: null,
    grantedScopes: [],
    missingScopes: [],
    redirectUri: REDIRECT_URI,
    requiresSetup: true,
    powerModeAvailable: false,
    iframeFallbackAvailable: false,
    ...overrides,
  };
}

/** Lets queries and their render batches (scheduled with setTimeout) settle. */
async function flush() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
  if (!found) throw new Error(`No "${label}" button`);
  return found;
}

describe("MusicPlayerSourceSettings", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    musicApiMock.settings.mockResolvedValue(settings());
    spotifyApiMock.status.mockResolvedValue(status());
    spotifyApiMock.devices.mockResolvedValue({ provider: "spotify", devices: [] });
    spotifyApiMock.startSignIn.mockResolvedValue({
      provider: "spotify",
      signInId: "sign-in-1",
      authUrl: "https://accounts.spotify.com/authorize?client_id=abc123",
      redirectUri: REDIRECT_URI,
      expiresInMs: 600_000,
      localListener: true,
    });
    openExternalUrlMock.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.useRealTimers();
    for (const mock of [...Object.values(musicApiMock), ...Object.values(spotifyApiMock), openExternalUrlMock]) {
      mock.mockReset();
    }
  });

  async function render() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={client}>
          <MusicPlayerSourceSettings />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  it("explains the setup and keeps Connect off until a Client ID is entered", async () => {
    await render();

    expect(container.textContent).toContain(REDIRECT_URI);
    expect(container.textContent).toContain("Playback control needs Spotify Premium.");
    expect(container.textContent).toContain("Not connected to Spotify.");
    expect(button(container, "Connect").disabled).toBe(true);

    await act(async () => {
      typeInto(container.querySelector<HTMLInputElement>('input[placeholder*="Client ID"]')!, "abc123");
    });
    expect(button(container, "Connect").disabled).toBe(false);
  });

  it("opens Spotify's sign-in page and shows the account once the sign-in is done", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    spotifyApiMock.signInStatus.mockResolvedValue({ status: "done" });
    await render();

    await act(async () => {
      typeInto(container.querySelector<HTMLInputElement>('input[placeholder*="Client ID"]')!, "abc123");
    });
    await act(async () => {
      button(container, "Connect").click();
    });
    await flush();

    expect(spotifyApiMock.startSignIn).toHaveBeenCalledWith("abc123");
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://accounts.spotify.com/authorize?client_id=abc123");
    expect(container.textContent).toContain("Browser couldn't reach the callback? Paste the address here.");

    spotifyApiMock.status.mockResolvedValue(
      status({ connected: true, hasClientId: true, clientId: "abc123", displayName: "Xel" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flush();

    expect(spotifyApiMock.signInStatus).toHaveBeenCalledWith("sign-in-1");
    expect(container.textContent).toContain("Connected to Spotify");
    expect(container.textContent).toContain("Signed in as Xel.");
    expect(container.textContent).not.toContain("Paste the address here");
  });

  it("finishes a sign-in from a pasted address", async () => {
    spotifyApiMock.signInStatus.mockResolvedValue({ status: "waiting", expiresInMs: 500_000 });
    spotifyApiMock.finishSignIn.mockResolvedValue(
      status({ connected: true, hasClientId: true, renewsAutomatically: true, missingScopes: ["user-library-read"] }),
    );
    musicApiMock.settings.mockResolvedValue(settings({ spotifyClientId: "abc123" }));
    await render();

    await act(async () => {
      button(container, "Connect").click();
    });
    await flush();
    const address = `${REDIRECT_URI}?code=xyz&state=s1`;
    await act(async () => {
      typeInto(container.querySelector<HTMLInputElement>(`input[placeholder^="${REDIRECT_URI}"]`)!, address);
    });
    await act(async () => {
      button(container, "Finish").click();
    });
    await flush();

    expect(spotifyApiMock.finishSignIn).toHaveBeenCalledWith(address);
    expect(container.textContent).toContain("Connected (renews automatically)");
    expect(container.textContent).toContain("missing Spotify permissions some features need (user-library-read)");
    expect(button(container, "Reconnect")).toBeTruthy();
  });
});
