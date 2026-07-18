import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageApi } from "../../../../../shared/api/storage-api";
import { CharacterWebResearchCard } from "./CharacterWebResearchCard";

describe("CharacterWebResearchCard", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not grant or regenerate before the user approves", () => {
    const patchMetadata = vi.spyOn(storageApi, "patchChatMetadata").mockResolvedValue({});
    const regenerate = vi.fn();
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CharacterWebResearchCard
            chatId="chat-1"
            messageId="message-1"
            request={{
              query: "current lunar eclipse date",
              reason: "The date can change.",
              allowedDomains: ["nasa.gov"],
              status: "pending",
            }}
            onRegenerate={regenerate}
          />
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).toContain("current lunar eclipse date");
    expect(patchMetadata).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("stores the exact visible scope and regenerates once when approved", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const patchMetadata = vi.spyOn(storageApi, "patchChatMetadata").mockResolvedValue({});
    const patchMessage = vi.spyOn(storageApi, "patchChatMessageExtra").mockResolvedValue({});
    const regenerate = vi.fn();
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CharacterWebResearchCard
            chatId="chat-1"
            messageId="message-1"
            request={{
              query: "current lunar eclipse date",
              reason: "The date can change.",
              allowedDomains: ["nasa.gov"],
              status: "pending",
            }}
            onRegenerate={regenerate}
          />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      container.querySelectorAll("button")[1]!.click();
    });

    expect(patchMetadata).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        characterWebResearchGrant: expect.objectContaining({
          id: "character-web-00000000-0000-4000-8000-000000000001",
          query: "current lunar eclipse date",
          allowedDomains: ["nasa.gov"],
          requestMessageId: "message-1",
        }),
      }),
    );
    expect(patchMessage).toHaveBeenCalledWith(
      "message-1",
      expect.objectContaining({
        characterWebResearchRequest: expect.objectContaining({ status: "approved" }),
      }),
    );
    expect(regenerate).toHaveBeenCalledOnce();
    expect(regenerate).toHaveBeenCalledWith("message-1");
  });
});
