import { describe, expect, it } from "vitest";
import { useGalleryStore } from "./gallery.store";

describe("useGalleryStore", () => {
  it("keeps a chat marked as illustrating until the generation task settles", async () => {
    const store = useGalleryStore.getState();
    store.finishIllustrating("chat-a");

    let resolveTask: () => void = () => undefined;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const run = (store as typeof store & {
      runIllustration: (chatId: string, task: () => Promise<void>) => Promise<void>;
    }).runIllustration("chat-a", () => task);

    expect(useGalleryStore.getState().illustratingChatIds).toEqual(["chat-a"]);

    resolveTask();
    await run;

    expect(useGalleryStore.getState().illustratingChatIds).toEqual([]);
  });
  it("rejects duplicate illustration runs instead of reporting fake success", async () => {
    const store = useGalleryStore.getState();
    store.finishIllustrating("chat-a");

    let resolveTask: () => void = () => undefined;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    let duplicateStarted = false;

    const run = store.runIllustration("chat-a", () => task);

    await expect(
      store.runIllustration("chat-a", () => {
        duplicateStarted = true;
      }),
    ).rejects.toThrow("Illustration is already generating for this chat.");
    expect(duplicateStarted).toBe(false);
    expect(useGalleryStore.getState().illustratingChatIds).toEqual(["chat-a"]);

    resolveTask();
    await run;

    expect(useGalleryStore.getState().illustratingChatIds).toEqual([]);
  });
});
