import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  status: vi.fn(),
  finish: vi.fn(),
  models: vi.fn(),
  test: vi.fn(),
  get: vi.fn(),
  update: vi.fn(async () => ({})),
  openExternalUrl: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
}));

vi.mock("../../../../shared/api/connection-command-api", () => ({
  connectionCommandApi: {
    openRouterLoginStart: mocks.start,
    openRouterLoginStatus: mocks.status,
    openRouterLoginFinish: mocks.finish,
    models: mocks.models,
    test: mocks.test,
  },
}));
vi.mock("../../../../shared/api/storage-api", () => ({ storageApi: { get: mocks.get, update: mocks.update } }));
vi.mock("../../../../shared/api/external-link-api", () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock("../../../catalog/connections", () => ({ useRefreshConnection: () => mocks.refresh }));

import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { OpenRouterLoginCard } from "./OpenRouterLoginCard";

const AUTH_URL = "https://openrouter.ai/auth?code_challenge=abc";

describe("OpenRouterLoginCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.update.mockResolvedValue({});
    mocks.openExternalUrl.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({ id: "conn-1", provider: "openrouter", model: "" });
    mocks.models.mockResolvedValue({
      fromProvider: true,
      models: [
        { id: "openai/gpt-5.5", name: "GPT-5.5", context: 400_000 },
        { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B (free)", context: 262_144 },
      ],
    });
    useSetupJourneyStore.getState().clearIntent();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const button = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
  const render = (prepare = vi.fn(async () => "conn-1")) => {
    act(() => root.render(<OpenRouterLoginCard variant="inline" prepare={prepare} />));
    return prepare;
  };
  const flush = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const poll = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
  };

  // People new to AI apps don't have a key. The browser login saves one, and an empty connection
  // starts on a free model so the first chat costs nothing.
  it("opens the browser login, waits for it, and starts an empty connection on a free model", async () => {
    mocks.start.mockResolvedValue({ loginId: "login-1", authUrl: AUTH_URL, mode: "callback", expiresInMs: 600_000 });
    mocks.status.mockResolvedValueOnce({ status: "waiting", connectionId: "conn-1" });
    mocks.status.mockResolvedValueOnce({ status: "done", connectionId: "conn-1" });
    const prepare = render();

    await act(async () => button("Log in with OpenRouter")!.click());
    await flush();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith("conn-1");
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(AUTH_URL);
    expect(host.textContent).toContain("Finish in your browser");

    await poll();
    expect(host.textContent).toContain("Finish in your browser");
    await poll();
    await flush();

    expect(mocks.update).toHaveBeenCalledWith("connections", "conn-1", {
      model: "google/gemma-4-31b-it:free",
      maxContext: 262_144,
    });
    expect(mocks.refresh).toHaveBeenCalledWith("conn-1");
    expect(host.textContent).toContain("Chats use Gemma 4 31B (free), which is free.");
    expect(mocks.test).not.toHaveBeenCalled();
  });

  it("shows the link when the browser can't be opened", async () => {
    mocks.start.mockResolvedValue({ loginId: "login-1", authUrl: AUTH_URL, mode: "callback", expiresInMs: 600_000 });
    mocks.openExternalUrl.mockRejectedValue(new Error("The browser blocked the external URL popup."));
    mocks.status.mockResolvedValue({ status: "waiting", connectionId: "conn-1" });
    render();

    await act(async () => button("Log in with OpenRouter")!.click());
    await flush();

    expect(host.textContent).toContain("Your browser didn't open.");
    expect(host.querySelector<HTMLAnchorElement>("a")?.href).toBe(AUTH_URL);
  });

  // A server on a Pi can't catch a redirect meant for the phone, so OpenRouter shows a code instead.
  it("finishes a paste-a-code login and keeps a model the connection already has", async () => {
    mocks.start.mockResolvedValue({ loginId: "login-2", authUrl: AUTH_URL, mode: "code", expiresInMs: 600_000 });
    mocks.finish.mockResolvedValue({ status: "done", connectionId: "conn-1" });
    mocks.get.mockResolvedValue({ id: "conn-1", provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" });
    render();

    await act(async () => button("Log in with OpenRouter")!.click());
    await flush();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLAnchorElement>("a")?.href).toBe(AUTH_URL);
    expect(button("Finish")!.disabled).toBe(true);

    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "pasted-code");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Finish")!.click());
    await flush();

    expect(mocks.finish).toHaveBeenCalledWith("login-2", "pasted-code");
    expect(mocks.models).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Logged in to OpenRouter. Your key is saved.");
  });

  it("checks the connection and moves setup along when the login happens during setup", async () => {
    useSetupJourneyStore.getState().begin("conversation");
    mocks.start.mockResolvedValue({ loginId: "login-3", authUrl: AUTH_URL, mode: "callback", expiresInMs: 600_000 });
    mocks.status.mockResolvedValue({ status: "done", connectionId: "conn-1" });
    mocks.test.mockResolvedValue({ success: true, message: "Connected.", latencyMs: 12 });
    render();

    await act(async () => button("Log in with OpenRouter")!.click());
    await poll();
    await flush();

    expect(mocks.test).toHaveBeenCalledWith("conn-1");
    expect(useSetupJourneyStore.getState().testedConnectionIds).toContain("conn-1");
    expect(useSetupJourneyStore.getState().intent?.selectedConnectionId).toBe("conn-1");
  });

  it("says what went wrong and offers a fresh start when the login fails", async () => {
    mocks.start.mockResolvedValue({ loginId: "login-4", authUrl: AUTH_URL, mode: "callback", expiresInMs: 600_000 });
    mocks.status.mockResolvedValue({
      status: "failed",
      message: "OpenRouter login was cancelled. Go back to De-Koi and start it again if you want to connect.",
    });
    const prepare = render();

    await act(async () => button("Log in with OpenRouter")!.click());
    await poll();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("OpenRouter login was cancelled.");
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => button("Try again")!.click());
    await flush();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("stops checking on a login after Cancel", async () => {
    mocks.start.mockResolvedValue({ loginId: "login-5", authUrl: AUTH_URL, mode: "callback", expiresInMs: 600_000 });
    mocks.status.mockResolvedValue({ status: "done", connectionId: "conn-1" });
    render();

    await act(async () => button("Log in with OpenRouter")!.click());
    await flush();
    act(() => button("Cancel")!.click());
    await poll();

    expect(mocks.status).not.toHaveBeenCalled();
    expect(button("Log in with OpenRouter")).toBeDefined();
  });
});
