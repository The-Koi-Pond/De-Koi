import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { SetupReadinessChecklist } from "../../onboarding/shell";
import { ConnectionsPanel } from "./ConnectionsPanel";

vi.mock("../../../catalog/connections", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const empty: never[] = [];
  return {
    useConnections: () => ({ data: empty, isLoading: false }),
    isSyntheticConnection: () => false,
    useDuplicateConnection: mutation,
    useDeleteConnection: mutation,
    useUploadConnectionImage: mutation,
    useUpdateConnection: mutation,
    useConnectionFolders: () => ({ data: empty }),
    useCreateConnectionFolder: mutation,
    useUpdateConnectionFolder: mutation,
    useDeleteConnectionFolder: mutation,
    useReorderConnectionFolders: mutation,
    useMoveConnection: mutation,
  };
});
vi.mock("./LocalSidecarCard", () => ({ LocalSidecarCard: () => null }));
vi.mock("../../../shell/settings/index", () => ({ TTSConfigCard: () => null }));
vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

describe("ConnectionsPanel setup routing", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useSetupJourneyStore.getState().begin("conversation");
    useUIStore.setState({ rightPanelOpen: false, rightPanel: "chat" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("routes connection setup into the real Connections owner context and restores connection focus", async () => {
    function ConnectionOwnerHarness() {
      const open = useUIStore((state) => state.rightPanelOpen && state.rightPanel === "connections");
      return (
        <>
          <SetupReadinessChecklist
            facts={{
              environment: "embedded",
              runtimeUrl: null,
              runtimeHealth: "not-required",
              usableConnectionCount: 0,
            }}
            onCreateConnection={() => useUIStore.getState().openRightPanel("connections")}
          />
          {open && <ConnectionsPanel />}
        </>
      );
    }
    act(() => root.render(<ConnectionOwnerHarness />));
    act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Add connection"))!
        .click(),
    );
    expect(host.textContent).toContain("Add a language model to continue setup");
    expect(host.querySelector('[data-setup-focus="connection"]')).toBeTruthy();
    expect(host.textContent).toContain("Add Connection");
    act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Return to setup"))!
        .click(),
    );
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement?.id).toBe("setup-step-connection");
  });
});
