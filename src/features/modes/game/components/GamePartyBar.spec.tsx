import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamePartyBar } from "./GamePartyBar";

const pageActivity = vi.hoisted(() => ({ active: false }));

vi.mock("../../../../shared/hooks/use-page-activity", () => ({
  usePageActivity: () => pageActivity.active,
}));

vi.mock("../stores/game-mode.store", () => ({
  useGameModeStore: (selector: (state: { openCharacterSheet: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ openCharacterSheet: vi.fn() }),
}));

describe("GamePartyBar preview activity", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  const renderPartyBar = () =>
    root!.render(
      <GamePartyBar
        partyMembers={[
          { id: "a", name: "Aster" },
          { id: "b", name: "Bramble" },
        ]}
        partyCards={{}}
      />,
    );

  const previewButton = () => container!.querySelector<HTMLButtonElement>('button[aria-label="Open party members"]')!;

  beforeEach(() => {
    vi.useFakeTimers();
    pageActivity.active = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.useRealTimers();
  });

  it("pauses hidden previews, resumes one timer, and cleans up", () => {
    act(renderPartyBar);
    expect(previewButton().textContent).toContain("A");

    act(() => vi.advanceTimersByTime(2500));
    expect(previewButton().textContent).toContain("A");

    pageActivity.active = true;
    act(renderPartyBar);
    act(() => vi.advanceTimersByTime(2500));
    expect(previewButton().textContent).toContain("B");
    expect(vi.getTimerCount()).toBe(1);

    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
