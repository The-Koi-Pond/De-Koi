import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import type { ConnectionSummary } from "../../../../../catalog/connections/index";
import { AdvancedParametersSection } from "./AdvancedParametersSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storedConnection: ConnectionSummary = {
  id: "stored-connection",
  name: "Stored",
  provider: "openai",
  model: "gpt-5.2",
  capabilities: { reasoning: true },
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

function renderAdvancedParameters(
  connectionId: string | null,
  metadata: Record<string, unknown> = {},
  promptPresetParameters?: unknown,
): { container: HTMLDivElement; root: Root; mutate: ReturnType<typeof vi.fn> } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const mutate = vi.fn();

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AdvancedParametersSection
          chat={{ id: "chat-1" } as Chat}
          metadata={metadata}
          updateMeta={{ mutate } as never}
          mode="conversation"
          connectionId={connectionId}
          connections={[localSidecarConnection, storedConnection]}
          promptPresetParameters={promptPresetParameters}
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

  return { container, root, mutate };
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

  it("shows the recommendation and lets a user opt into or out of custom values", () => {
    const recommended = renderAdvancedParameters("stored-connection");
    expect(recommended.container.textContent).toContain("conversation-balanced");
    expect(recommended.container.textContent).toContain("balanced sampling");

    const customButton = Array.from(recommended.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Custom",
    );
    act(() => customButton!.click());
    expect(recommended.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "chat-1",
        generationProfileMode: "custom",
        chatParameters: expect.objectContaining({
          temperature: 0.7,
          maxTokens: 2048,
          reasoningEffort: "low",
        }),
      }),
    );
    act(() => recommended.root.unmount());

    const custom = renderAdvancedParameters("stored-connection", {
      generationProfileMode: "custom",
      chatParameters: { temperature: 0.2 },
    });
    const recommendedButton = Array.from(custom.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Recommended",
    );
    act(() => recommendedButton!.click());
    expect(custom.mutate).toHaveBeenLastCalledWith({
      id: "chat-1",
      generationProfileMode: "recommended",
      chatParameters: null,
    });
    act(() => custom.root.unmount());
  });

  it("explains the provider-neutral fallback when metadata is unavailable", () => {
    const fallback = renderAdvancedParameters("random");
    expect(fallback.container.textContent).toContain("provider-neutral-fallback");
    expect(fallback.container.textContent).toContain("metadata is unavailable or stale");
    act(() => fallback.root.unmount());
  });

  it("does not label inherited preset values as Recommended", () => {
    const inherited = renderAdvancedParameters("stored-connection", {}, { temperature: 0.2 });
    const clearOverridesButton = Array.from(inherited.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Clear Chat Overrides",
    );
    const customButton = Array.from(inherited.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Custom",
    );

    expect(clearOverridesButton?.getAttribute("aria-pressed")).toBe("false");
    expect(
      Array.from(inherited.container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Recommended",
      ),
    ).toBeUndefined();
    expect(customButton?.getAttribute("aria-pressed")).toBe("true");
    expect(inherited.container.textContent).toContain("Custom values are inherited");
    act(() => inherited.root.unmount());
  });
});
