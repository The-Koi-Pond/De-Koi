import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../../shared/api/storage-api";
import { CharacterWebResearchCard } from "./CharacterWebResearchCard";

const request = {
  query: "current lunar eclipse date",
  reason: "The date may have changed.",
  allowedDomains: ["nasa.gov"],
  status: "pending" as const,
};

describe("CharacterWebResearchCard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient();
    vi.spyOn(storageApi, "patchChatMetadata").mockResolvedValue({} as never);
    vi.spyOn(storageApi, "patchChatMessageExtra").mockResolvedValue({} as never);
  });

  afterEach(() => {
    act(() => root?.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  function render(onRegenerate: (messageId: string, options?: { propagateErrors?: boolean }) => void | Promise<void>) {
    act(() => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <CharacterWebResearchCard
            chatId="chat-1"
            messageId="message-1"
            request={request}
            onRegenerate={onRegenerate}
          />
        </QueryClientProvider>,
      );
    });
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  }

  it("does not grant or regenerate before the user approves", () => {
    const onRegenerate = vi.fn();
    render(onRegenerate);

    expect(container.textContent).toContain(request.query);
    expect(storageApi.patchChatMetadata).not.toHaveBeenCalled();
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("offers an always-allow choice for the current chat", () => {
    render(vi.fn());

    expect(button("Always allow")).toBeTruthy();
  });

  it("keeps the request actionable and shows the retry error when regeneration fails", async () => {
    render(vi.fn().mockRejectedValue(new Error("Gemini rejected the request.")));

    await act(async () => {
      button("Allow once").click();
    });

    expect(container.textContent).toContain("Web research couldn't continue. The approval is still here; try again.");
    expect(button("Allow once").disabled).toBe(false);
  });

  it("stores the exact visible scope and awaits one regeneration when allowed once", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    render(onRegenerate);

    await act(async () => {
      button("Allow once").click();
    });

    expect(storageApi.patchChatMetadata).toHaveBeenCalledWith("chat-1", {
      characterWebResearchGrant: expect.objectContaining({
        id: "character-web-00000000-0000-4000-8000-000000000001",
        query: request.query,
        allowedDomains: request.allowedDomains,
        requestMessageId: "message-1",
      }),
    });
    expect(storageApi.patchChatMessageExtra).not.toHaveBeenCalled();
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onRegenerate).toHaveBeenCalledWith("message-1", {
      propagateErrors: true,
      skipTouchConfirm: true,
    });
  });

  it("stores always approval before awaiting regeneration", async () => {
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    render(onRegenerate);

    await act(async () => {
      button("Always allow").click();
    });

    expect(storageApi.patchChatMetadata).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        characterWebResearchPolicy: "always",
        characterWebResearchGrant: expect.objectContaining({
          query: request.query,
          requestMessageId: "message-1",
        }),
      }),
    );
    expect(onRegenerate).toHaveBeenCalledWith("message-1", {
      propagateErrors: true,
      skipTouchConfirm: true,
    });
  });
});
