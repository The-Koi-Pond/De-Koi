import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/stores/ui.store", () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      enterToSendGame: true,
      speechToTextEnabled: false,
      quoteFormat: "straight",
      showQuickRepliesMenu: false,
      userQuickReplyActions: [],
    }),
}));

vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeChatId: null, activeChat: null }),
}));

vi.mock("../../../../shared/hooks/use-draft-translation", () => ({
  getDraftTranslationActionState: () => ({ action: "translate", disabled: true }),
  useDraftTranslation: () => ({
    isTranslatingDraft: false,
    translateDraft: vi.fn(),
    cancelDraftTranslation: vi.fn(),
  }),
}));

import { GameInput } from "./GameInput";
import { confirmDiscardPendingAppWork, hasPendingAppCloseWork } from "../../../../shared/lib/app-close-guard";
import { gameInputDrafts } from "../lib/game-input-drafts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("GameInput chat-scoped drafts", () => {
  let root: Root | null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container.remove();
  });

  const renderInput = (draftKey: string, onSend: () => boolean | Promise<boolean> = () => true) => {
    root!.render(
      <GameInput
        draftKey={draftKey}
        onSend={onSend}
        onRollDice={async () => null}
        disabled={false}
        isStreaming={false}
      />,
    );
  };

  const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
  const buttonByTitle = (title: string) => container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;

  it("restores text, queued dice, and address mode independently when chats switch", () => {
    const suffix = crypto.randomUUID();
    act(() => renderInput(`a-${suffix}`));
    act(() => setTextareaValue(textarea(), "A draft"));
    act(() => buttonByTitle("Roll dice").click());
    const d20 = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("d20"));
    act(() => d20?.click());
    act(() => buttonByTitle("Choose who to address").click());
    const talkToGm = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Talk to GM"),
    );
    act(() => talkToGm?.click());

    act(() => renderInput(`b-${suffix}`));
    expect(textarea().value).toBe("");
    expect(container.textContent).not.toContain("d20");
    expect(textarea().placeholder).toBe("What do you do?");

    act(() => renderInput(`a-${suffix}`));
    expect(textarea().value).toBe("A draft");
    expect(container.textContent).toContain("d20");
    expect(textarea().placeholder).toBe("Say to GM...");
  });

  it("does not clear a newly active chat when an earlier send finishes", async () => {
    const suffix = crypto.randomUUID();
    const sendA = deferred<boolean>();
    act(() => renderInput(`a-${suffix}`, () => sendA.promise));
    act(() => setTextareaValue(textarea(), "send A"));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Send game turn"]')?.click());

    act(() => renderInput(`b-${suffix}`));
    act(() => setTextareaValue(textarea(), "keep B"));
    await act(async () => sendA.resolve(true));

    expect(textarea().value).toBe("keep B");
    act(() => renderInput(`a-${suffix}`));
    expect(textarea().value).toBe("");
  });

  it("retains the origin chat after a failed send", async () => {
    const suffix = crypto.randomUUID();
    const sendA = deferred<boolean>();
    act(() => renderInput(`a-${suffix}`, () => sendA.promise));
    act(() => setTextareaValue(textarea(), "retry A"));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Send game turn"]')?.click());
    act(() => renderInput(`b-${suffix}`));

    await act(async () => sendA.resolve(false));
    act(() => renderInput(`a-${suffix}`));
    expect(textarea().value).toBe("retry A");
  });

  it("keeps cached attachments protected after unmount without blocking chat navigation", async () => {
    const draftKey = `close-${crypto.randomUUID()}`;
    act(() => renderInput(draftKey));
    gameInputDrafts.addAttachment(draftKey, {
      type: "image/png",
      data: "data:image/png;base64,pending",
      name: "pending.png",
    });

    act(() => root?.unmount());
    root = null;

    expect(hasPendingAppCloseWork()).toBe(true);
    await expect(confirmDiscardPendingAppWork({ purpose: "navigation" })).resolves.toBe(true);
    gameInputDrafts.removeAttachment(draftKey, 0);
  });
});
