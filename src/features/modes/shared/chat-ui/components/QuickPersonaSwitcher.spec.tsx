import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickPersonaSwitcher } from "./QuickPersonaSwitcher";

vi.mock("../../../../catalog/personas/index", () => ({
  PersonaAvatarImage: () => null,
  usePersona: () => ({ data: null }),
  usePersonaGroups: () => ({ data: [] }),
  usePersonaSummaries: () => ({ data: [] }),
}));

vi.mock("../../../../catalog/chats/index", () => ({
  useChat: () => ({ data: { id: "chat-1", personaId: null } }),
  useUpdateChat: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../../../../shared/stores/chat.store", () => ({
  useChatStore: (selector: (state: { activeChatId: string }) => unknown) =>
    selector({ activeChatId: "chat-1" }),
}));

describe("QuickPersonaSwitcher", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("uses a persona glyph instead of a question mark when no persona is selected", () => {
    act(() => {
      root = createRoot(container!);
      root.render(<QuickPersonaSwitcher />);
    });

    const trigger = container!.querySelector<HTMLButtonElement>('button[title="Quick Persona Switcher"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).not.toContain("?");

    act(() => {
      trigger!.click();
    });

    expect(container!.textContent).not.toContain("?");
  });
});
