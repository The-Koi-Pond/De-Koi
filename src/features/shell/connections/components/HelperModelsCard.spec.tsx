import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelRoutingApi } from "../../../../shared/api/model-routing-api";
import { HelperModelsCard } from "./HelperModelsCard";

const connections = [
  { id: "strong", name: "Strong", provider: "anthropic", model: "big-model" },
  { id: "agents", name: "Agents", provider: "openai", model: "agent-model", defaultForAgents: true },
  { id: "cheap", name: "Cheap", provider: "openai", model: "small-model" },
  { id: "pictures", name: "Pictures", provider: "image_generation", model: "image-model" },
];

vi.mock("../../../catalog/connections", () => ({
  useConnections: () => ({ data: connections }),
}));

vi.mock("../../../../shared/api/model-routing-api", () => ({
  modelRoutingKeys: { settings: ["model-routing"] },
  modelRoutingApi: { get: vi.fn(), setRoute: vi.fn(), setLocalOnly: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("HelperModelsCard", () => {
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
          <HelperModelsCard />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  function select(name: string): HTMLSelectElement {
    const label = Array.from(container.querySelectorAll("label")).find((item) => item.textContent === name);
    return document.getElementById(label!.htmlFor) as HTMLSelectElement;
  }

  function status(name: string): string {
    const id = select(name).getAttribute("aria-describedby")!;
    return document.getElementById(id)!.textContent ?? "";
  }

  it("shows what each unrouted helper uses today and offers only text connections", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: {} });
    await render();

    expect(select("Memory").value).toBe("");
    expect(status("Memory")).toBe(
      "Same as today: Default for Agents (Agents • agent-model), else each chat's connection.",
    );
    expect(status("Habit check")).toBe("Same as today: each chat's connection.");
    expect(status("Fanfic judge")).toBe("Same as today: each fic's connection.");
    for (const name of ["Group responder", "Status blurbs", "Schedules", "Character reads"]) {
      expect(status(name)).toBe("Same as today: each chat's connection.");
    }
    expect(Array.from(select("Memory").options).map((option) => option.textContent)).toEqual([
      "Same as today",
      "Strong • big-model",
      "Agents • agent-model",
      "Cheap • small-model",
    ]);
  });

  it("saves a route and shows the connection it now uses", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: {} });
    vi.mocked(modelRoutingApi.setRoute).mockResolvedValue({ version: 1, routes: { summaries: "cheap" } });
    await render();

    await act(async () => {
      const control = select("Summaries");
      control.value = "cheap";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(modelRoutingApi.setRoute).toHaveBeenCalledWith("summaries", "cheap");
    expect(select("Summaries").value).toBe("cheap");
    expect(status("Summaries")).toBe("Uses Cheap • small-model.");
  });

  it("flags a route to a deleted connection instead of hiding it", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { memory: "gone" } });
    await render();

    expect(select("Memory").value).toBe("gone");
    expect(select("Memory").selectedOptions[0]?.textContent).toBe("Missing connection");
    expect(status("Memory")).toBe(
      'The Memory helper is set to a connection that no longer exists. It won\'t run until you pick another connection or "Same as today".',
    );
  });

  it("names a Local Model route even while the Local Model is not listed", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { memory: "sidecar:local" } });
    await render();

    expect(select("Memory").selectedOptions[0]?.textContent).toBe("Local Model • local-sidecar");
    expect(status("Memory")).toBe("Uses Local Model • local-sidecar.");
  });

  it("says when the settings can't load and retries on request", async () => {
    vi.mocked(modelRoutingApi.get)
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue({ version: 1, routes: {} });
    await render();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load your helper models.");
    await act(async () => {
      Array.from(alert!.querySelectorAll("button"))
        .find((button) => button.textContent === "Retry")!
        .click();
    });
    await flush();

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(select("Memory").value).toBe("");
  });

  it("clears a route back to Same as today", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { memory: "cheap" } });
    vi.mocked(modelRoutingApi.setRoute).mockResolvedValue({ version: 1, routes: {} });
    await render();

    await act(async () => {
      const control = select("Memory");
      control.value = "";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(modelRoutingApi.setRoute).toHaveBeenCalledWith("memory", null);
    expect(select("Memory").value).toBe("");
  });

  function keepLocal(name: string): HTMLInputElement {
    return select(name).parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement;
  }

  it("marks a helper to stay on this device and says it needs a local connection", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: {} });
    vi.mocked(modelRoutingApi.setLocalOnly).mockResolvedValue({ version: 1, routes: {}, localOnly: ["status"] });
    await render();

    expect(keepLocal("Status blurbs").checked).toBe(false);
    await act(async () => {
      keepLocal("Status blurbs").click();
    });
    await flush();

    expect(modelRoutingApi.setLocalOnly).toHaveBeenCalledWith("status", true);
    expect(keepLocal("Status blurbs").checked).toBe(true);
    expect(status("Status blurbs")).toBe(
      `The Status blurbs helper must stay on your device, but has no connection on your device picked. It won't run until you pick a connection on this device or network, or untick "Keep on my device".`,
    );
    expect(status("Schedules")).toBe("Same as today: each chat's connection.");
  });

  it("flags a local-only helper routed off the device, and accepts the Local Model", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({
      version: 1,
      routes: { responder: "cheap", interpretations: "sidecar:local" },
      localOnly: ["responder", "interpretations"],
    });
    await render();

    expect(status("Group responder")).toBe(
      `The Group responder helper must stay on your device, but "Cheap" sends work off it. It won't run until you pick a connection on this device or network, or untick "Keep on my device".`,
    );
    expect(status("Character reads")).toBe("Uses Local Model • local-sidecar.");
  });
});
