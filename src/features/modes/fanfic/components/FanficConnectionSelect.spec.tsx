import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { storageApi } from "../../../../shared/api/storage-api";
import { chatKeys } from "../../../catalog/chats/index";
import { FanficReaderConnectionSelect } from "./FanficConnectionSelect";

let connections: Array<{ id: string; name?: string; provider?: string }> = [];

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { get: vi.fn(), update: vi.fn() },
}));

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({ data: connections }),
}));

const LANGUAGE = [
  { id: "conn-1", name: "Writer", provider: "anthropic" },
  { id: "conn-2", name: "Drafter", provider: "openai" },
];
const PICTURES = { id: "pics", name: "Pictures", provider: "image_generation" };

describe("FanficReaderConnectionSelect", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    connections = [...LANGUAGE, PICTURES];
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  function render({ connectionId = "conn-1", busy = false }: { connectionId?: string; busy?: boolean } = {}) {
    const chat = { id: "fic-1", mode: "fanfic", connectionId, metadata: { fanfic: { version: 1 } } };
    queryClient.setQueryData(chatKeys.detail("fic-1"), chat);
    vi.mocked(storageApi.get).mockResolvedValue(chat);
    act(() => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <FanficReaderConnectionSelect chatId="fic-1" busy={busy} />
        </QueryClientProvider>,
      );
    });
  }

  const select = () => container.querySelector("select");
  const options = () => Array.from(select()!.options).map((option) => [option.value, option.text, option.disabled]);
  const pick = async (id: string) => {
    await act(async () => {
      select()!.value = id;
      select()!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it("offers the language connections, not image models or the random pool, starting on the fic's", () => {
    render();

    expect(options()).toEqual([
      ["conn-1", "Writer", false],
      ["conn-2", "Drafter", false],
    ]);
    expect(select()!.value).toBe("conn-1");
  });

  it("shows the only connection's name without a picker", () => {
    connections = [LANGUAGE[0]!];
    render();

    expect(select()).toBeNull();
    expect(container.textContent).toContain("Writer");
  });

  it("can't be changed while a chapter is being written", () => {
    render({ busy: true });

    expect(select()!.disabled).toBe(true);
  });

  it("saves only the fic's connection when another model is picked, and keeps it", async () => {
    vi.mocked(storageApi.update).mockImplementation(async (_entity, _id, patch) => ({
      id: "fic-1",
      mode: "fanfic",
      ...patch,
    }));
    render();

    await pick("conn-2");

    expect(storageApi.update).toHaveBeenCalledWith("chats", "fic-1", { connectionId: "conn-2" });
    expect(select()!.value).toBe("conn-2");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("goes back to the previous model and says why when the save fails", async () => {
    vi.mocked(storageApi.update).mockRejectedValue(new Error("disk full"));
    render();

    await pick("conn-2");

    expect(storageApi.update).toHaveBeenCalledWith("chats", "fic-1", { connectionId: "conn-2" });
    expect(select()!.value).toBe("conn-1");
    expect(queryClient.getQueryData<{ connectionId: string }>(chatKeys.detail("fic-1"))?.connectionId).toBe("conn-1");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't change the model. The fic still uses the previous one.");
  });

  it("names the fic's current model even when it is no longer a text connection", () => {
    render({ connectionId: "pics" });

    expect(options()).toEqual([
      ["pics", "Pictures", true],
      ["conn-1", "Writer", false],
      ["conn-2", "Drafter", false],
    ]);
    expect(select()!.value).toBe("pics");
  });

  it("shows the id of a deleted connection the fic still points at", () => {
    render({ connectionId: "gone" });

    expect(options()[0]).toEqual(["gone", "gone", true]);
    expect(select()!.value).toBe("gone");
  });

  it("lets the fic move off a deleted connection onto the only one left", async () => {
    connections = [LANGUAGE[0]!];
    vi.mocked(storageApi.update).mockResolvedValue({ id: "fic-1", connectionId: "conn-1" });
    render({ connectionId: "gone" });

    expect(options()).toEqual([
      ["gone", "gone", true],
      ["conn-1", "Writer", false],
    ]);
    await pick("conn-1");

    expect(storageApi.update).toHaveBeenCalledWith("chats", "fic-1", { connectionId: "conn-1" });
  });
});
