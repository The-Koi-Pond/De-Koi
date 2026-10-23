import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelRoutingApi } from "../../../../shared/api/model-routing-api";
import { FanficQualityPanel } from "./FanficQualityPanel";

const mutate = vi.fn();

vi.mock("../../../catalog/chats/index", () => ({
  useChat: () => ({ data: { id: "fic-1", connectionId: "conn-1", metadata: {} } }),
}));

vi.mock("../../../catalog/connections/index", () => ({
  HelperRunNote: () => null,
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Writer", provider: "anthropic", model: "big" },
      { id: "conn-2", name: "Judge", provider: "openai", model: "small" },
    ],
  }),
}));

vi.mock("../hooks/use-fanfic", () => ({
  useFanficQuality: () => ({
    run: { mutate, isPending: false },
    remove: { mutate: vi.fn() },
    phase: null,
    stop: vi.fn(),
  }),
}));

vi.mock("../../../../shared/api/model-routing-api", () => ({
  modelRoutingKeys: { settings: ["model-routing"] },
  modelRoutingApi: { get: vi.fn() },
}));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("FanficQualityPanel judge choice", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <FanficQualityPanel chatId="fic-1" chapterTexts={["Chapter one."]} busy={false} />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  const judgeSelect = () => document.getElementById("fanfic-quality-judge") as HTMLSelectElement;
  const scoreButton = () =>
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Score this fic"))!;

  it("starts on the fanfic judge route and scores with it", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { judge: "conn-2" } });
    await render();

    expect(judgeSelect().value).toBe("conn-2");
    act(() => scoreButton().click());
    expect(mutate).toHaveBeenCalledWith({ connectionId: "conn-2", rule: "route", label: "" }, expect.anything());
  });

  it("starts on the fic's connection when the judge is not routed", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: {} });
    await render();

    expect(judgeSelect().value).toBe("conn-1");
  });

  it("picks no judge and explains a broken route until one is picked", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { judge: "gone" } });
    await render();

    expect(judgeSelect().value).toBe("");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The Fanfic judge helper is set to a connection that no longer exists.",
    );
    expect(scoreButton().disabled).toBe(true);

    await act(async () => {
      judgeSelect().value = "conn-1";
      judgeSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(scoreButton().disabled).toBe(false);
    // A judge changed by hand is noted as picked for this run, not as the route.
    act(() => scoreButton().click());
    expect(mutate).toHaveBeenCalledWith({ connectionId: "conn-1", rule: "picked", label: "" }, expect.anything());
  });
});
