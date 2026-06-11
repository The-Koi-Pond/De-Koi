import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import type { ConnectionSummary } from "../../../../../catalog/connections/index";
import { AdvancedParametersSection } from "./AdvancedParametersSection";

const storedConnection: ConnectionSummary = {
  id: "stored-connection",
  name: "Stored",
  provider: "openai",
  model: "gpt-test",
  baseUrl: "",
  useForRandom: false,
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

const localSidecarConnection: ConnectionSummary = {
  ...storedConnection,
  id: "sidecar:local",
  name: "Local Model",
  provider: "custom",
  synthetic: true,
};

function renderAdvancedParameters(connectionId: string | null): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AdvancedParametersSection
          chat={{ id: "chat-1" } as Chat}
          metadata={{}}
          updateMeta={{ mutate: vi.fn() } as never}
          isConversation={true}
          connectionId={connectionId}
          connections={[localSidecarConnection, storedConnection]}
        />
      </QueryClientProvider>,
    );
  });

  const header = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Advanced Parameters"),
  );
  expect(header).toBeTruthy();
  act(() => {
    header!.click();
  });

  return { container, root };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("AdvancedParametersSection", () => {
  it("shows connection-default save only for stored connection rows", () => {
    const stored = renderAdvancedParameters("stored-connection");
    expect(stored.container.textContent).toContain("Save as Connection Default");
    act(() => stored.root.unmount());

    const sidecar = renderAdvancedParameters("sidecar:local");
    expect(sidecar.container.textContent).not.toContain("Save as Connection Default");
    act(() => sidecar.root.unmount());

    const random = renderAdvancedParameters("random");
    expect(random.container.textContent).not.toContain("Save as Connection Default");
    act(() => random.root.unmount());
  });
});
