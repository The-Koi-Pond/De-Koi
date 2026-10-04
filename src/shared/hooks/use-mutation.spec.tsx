import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMutation, type AppMutationMeta } from "./use-mutation";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mutation = ReturnType<typeof useMutation<unknown, Error, string>>;

let container: HTMLDivElement;
let root: Root;
let mutation: Mutation;

function Probe({ meta, onError }: { meta?: AppMutationMeta; onError?: () => void }) {
  mutation = useMutation<unknown, Error, string>({
    mutationFn: () => Promise.reject(new Error("disk full")),
    meta,
    onError,
  });
  return null;
}

function render(props: { meta?: AppMutationMeta; onError?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe {...props} />
      </QueryClientProvider>,
    ),
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  toastMocks.error.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useMutation", () => {
  it("tells the user when a fire-and-forget mutate() fails", async () => {
    render();
    act(() => mutation.mutate("x"));
    await settle();
    expect(toastMocks.error).toHaveBeenCalledWith("Couldn't save that change. Try again.", expect.any(Object));
  });

  it("uses the mutation's own message when it sets one", async () => {
    render({ meta: { errorMessage: "Couldn't pin that chat." } });
    act(() => mutation.mutate("x"));
    await settle();
    expect(toastMocks.error).toHaveBeenCalledWith("Couldn't pin that chat.", expect.any(Object));
  });

  it("still reports a failure that lands after the calling component unmounted", async () => {
    render();
    act(() => mutation.mutate("x"));
    act(() => root.unmount());
    root = createRoot(container);
    await settle();
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the call site handles the error", async () => {
    const onError = vi.fn();
    render();
    act(() => mutation.mutate("x", { onError }));
    await settle();
    expect(onError).toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("stays quiet when the mutation reports its own errors", async () => {
    const onError = vi.fn();
    render({ meta: { handlesOwnErrors: true }, onError });
    act(() => mutation.mutate("x"));
    await settle();
    expect(onError).toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("leaves mutateAsync() rejections to the caller", async () => {
    render();
    let caught: unknown;
    await act(async () => {
      caught = await mutation.mutateAsync("x").catch((error: unknown) => error);
    });
    await settle();
    expect(caught).toBeInstanceOf(Error);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
