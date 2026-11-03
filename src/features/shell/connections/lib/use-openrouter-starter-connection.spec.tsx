import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "conn-new" })),
  remove: vi.fn(async () => undefined),
  get: vi.fn(),
}));

vi.mock("../../../catalog/connections", () => ({
  useCreateConnection: () => ({ mutateAsync: mocks.create, isPending: false }),
  useDeleteConnection: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock("../../../../shared/api/storage-api", () => ({ storageApi: { get: mocks.get } }));

import { useOpenRouterStarterConnection } from "./use-openrouter-starter-connection";

describe("useOpenRouterStarterConnection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let starter: ReturnType<typeof useOpenRouterStarterConnection>;

  function Probe() {
    starter = useOpenRouterStarterConnection();
    return <span>{starter.active ? "active" : "idle"}</span>;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    for (const mock of Object.values(mocks)) mock.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("creates one OpenRouter connection and reuses it when the login is retried", async () => {
    let first: string | null = null;
    let second: string | null = null;
    await act(async () => {
      first = await starter.prepare();
      second = await starter.prepare();
    });

    expect(first).toBe("conn-new");
    expect(second).toBe("conn-new");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "OpenRouter", provider: "openrouter", apiKey: "", model: "" }),
    );
    expect(host.textContent).toBe("active");
  });

  // Backing out of the first-run login shouldn't leave an empty connection that looks set up.
  it("removes the connection on cancel only while it still has no key", async () => {
    mocks.get.mockResolvedValueOnce({ id: "conn-new", hasApiKey: false });
    await act(async () => {
      await starter.prepare();
      await starter.cancel();
    });
    expect(mocks.remove).toHaveBeenCalledWith("conn-new");
    expect(host.textContent).toBe("idle");

    mocks.get.mockResolvedValueOnce({ id: "conn-new", hasApiKey: true });
    await act(async () => {
      await starter.prepare();
      await starter.cancel();
    });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
