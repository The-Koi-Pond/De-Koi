import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { onlineManager, type QueryClient as QueryClientType } from "@tanstack/react-query";

const mainMocks = vi.hoisted(() => ({
  queryClient: null as QueryClientType | null,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();

  return {
    ...actual,
    QueryClient: class extends actual.QueryClient {
      constructor(config?: ConstructorParameters<typeof actual.QueryClient>[0]) {
        super(config);
        mainMocks.queryClient = this;
      }
    },
  };
});

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: () => ({
      render: vi.fn(),
    }),
  },
}));

vi.mock("./App", () => ({
  App: () => null,
}));

vi.mock("./GlobalErrorBoundary", () => ({
  GlobalErrorBoundary: ({ children }: { children: unknown }) => children,
  installGlobalErrorDiagnostics: vi.fn(),
  reportReactRootError: vi.fn(),
}));

vi.mock("../shared/lib/performance-diagnostics", () => ({
  markPerformanceMilestone: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  mainMocks.queryClient = null;
  document.body.innerHTML = '<div id="root"></div>';
  onlineManager.setOnline(true);
});

afterEach(() => {
  onlineManager.setOnline(true);
  mainMocks.queryClient?.unmount();
  mainMocks.queryClient?.clear();
  document.body.innerHTML = "";
});

it("runs local queries and mutations when the webview reports offline", async () => {
  await import("./main");
  const queryClient = mainMocks.queryClient;
  expect(queryClient).not.toBeNull();
  queryClient!.mount();
  onlineManager.setOnline(false);

  let queryRuns = 0;
  let mutationRuns = 0;
  const queryPromise = queryClient!.fetchQuery({
    queryKey: ["offline-local-query"],
    queryFn: async () => {
      queryRuns += 1;
      return "query-ok";
    },
  });
  const mutation = queryClient!.getMutationCache().build(queryClient!, {
    mutationFn: async () => {
      mutationRuns += 1;
      return "mutation-ok";
    },
  });
  const mutationPromise = mutation.execute(undefined);

  try {
    await vi.waitFor(
      () => {
        expect(queryRuns).toBe(1);
        expect(mutationRuns).toBe(1);
      },
      { timeout: 1_000 },
    );
  } finally {
    onlineManager.setOnline(true);
    await Promise.all([queryPromise, mutationPromise]);
  }
});

it("pauses failed remote retries until the webview reconnects", async () => {
  await import("./main");
  const queryClient = mainMocks.queryClient;
  expect(queryClient).not.toBeNull();
  queryClient!.mount();
  onlineManager.setOnline(false);

  let attempts = 0;
  const queryPromise = queryClient!.fetchQuery({
    queryKey: ["offline-remote-query"],
    retryDelay: 0,
    queryFn: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("remote unavailable");
      }
      return "remote-ok";
    },
  });

  await vi.waitFor(() => {
    expect(attempts).toBe(1);
    expect(queryClient!.getQueryState(["offline-remote-query"])?.fetchStatus).toBe("paused");
  });

  onlineManager.setOnline(true);

  await expect(queryPromise).resolves.toBe("remote-ok");
  expect(attempts).toBe(2);
});
