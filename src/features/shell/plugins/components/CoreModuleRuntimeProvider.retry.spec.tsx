import { act, Component, Suspense, useMemo, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoreModuleLazy } from "./CoreModuleRuntimeProvider";

function LoadedNotes() {
  return <span>Loaded notes</span>;
}

class TestBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <button onClick={this.props.onRetry}>Retry loading notes</button>;
    }
    return this.props.children;
  }
}

function RetryHarness({ load }: { load: () => Promise<{ default: typeof LoadedNotes }> }) {
  const [attempt, setAttempt] = useState(0);
  const LazyNotes = useMemo(() => createCoreModuleLazy(load), [attempt, load]);
  return (
    <TestBoundary key={attempt} onRetry={() => setAttempt((current) => current + 1)}>
      <Suspense fallback={<span>Loading notes</span>}>
        <LazyNotes />
      </Suspense>
    </TestBoundary>
  );
}

function waitForReact() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("core module lazy retry", () => {
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    vi.restoreAllMocks();
  });

  it("recreates the lazy module after a failed load retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<{ default: typeof LoadedNotes }>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce({ default: LoadedNotes });
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(<RetryHarness load={load} />);
      await waitForReact();
    });

    expect(container.textContent).toContain("Retry loading notes");

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitForReact();
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Loaded notes");
  });
});