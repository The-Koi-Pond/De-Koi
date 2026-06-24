import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "../../../../engine/contracts/types/theme";
import { storageApi } from "../../../../shared/api/storage-api";
import { useCreateTheme } from "./use-themes";

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    create: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
}));

type ThemeMutations = {
  createTheme: ReturnType<typeof useCreateTheme>;
};

function theme(overrides: Partial<Theme>): Theme {
  return {
    id: "theme-1",
    name: "Neon",
    css: ":root { --primary: #ff00aa; }",
    installedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isActive: false,
    ...overrides,
  };
}

function ThemeMutationProbe({ onReady }: { onReady: (mutations: ThemeMutations) => void }) {
  const createTheme = useCreateTheme();

  useEffect(() => {
    onReady({ createTheme });
  }, [createTheme, onReady]);

  return null;
}

describe("theme settings hooks", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let queryClient: QueryClient;
  let mutations: ThemeMutations | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    mutations = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    queryClient.clear();
  });

  async function renderProbe() {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeMutationProbe
            onReady={(nextMutations) => {
              mutations = nextMutations;
            }}
          />
        </QueryClientProvider>,
      );
    });
  }

  it("adds created themes to the cached list without clearing the current active theme", async () => {
    const activeTheme = theme({ id: "active-theme", isActive: true, active: true });
    const createdTheme = theme({
      id: "created-theme",
      name: "Aurora",
      css: ":root { --background: #101827; }",
      isActive: false,
      active: false,
    });
    queryClient.setQueryData<Theme[]>(["themes", "list"], [activeTheme]);
    vi.mocked(storageApi.create).mockResolvedValue(createdTheme as never);

    await renderProbe();

    await act(async () => {
      await mutations!.createTheme.mutateAsync({
        name: createdTheme.name,
        css: createdTheme.css,
        installedAt: createdTheme.installedAt,
      });
    });

    expect(queryClient.getQueryData<Theme[]>(["themes", "list"])).toEqual([activeTheme, createdTheme]);
  });
});
