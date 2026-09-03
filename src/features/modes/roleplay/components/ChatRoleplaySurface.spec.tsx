import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyContinuityDirectorCommand,
  countProposedContinuityDirectorBeats,
  createDefaultContinuityDirectorState,
} from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { ContinuityDirectorReviewEntryPoint, RoleplayBackgroundLayer } from "./ChatRoleplaySurface";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../../shared/api/local-file-api", () => ({
  resolveManagedLocalAssetUrl: async (url: string | null | undefined) => url ?? null,
}));

async function flushBackgroundEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function backgroundImages(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".mari-background")).map(
    (element) => element.style.backgroundImage,
  );
}

describe("RoleplayBackgroundLayer", () => {
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
    vi.restoreAllMocks();
  });

  it("drops the previous chat background immediately when a new chat has none", async () => {
    act(() => {
      root = createRoot(container!);
      root.render(<RoleplayBackgroundLayer activeChatId="chat-a" chatBackground="https://example.test/old-bg.png" />);
    });
    await flushBackgroundEffects();

    expect(backgroundImages(container!).some((image) => image.includes("old-bg.png"))).toBe(true);

    act(() => {
      root!.render(<RoleplayBackgroundLayer activeChatId="chat-b" chatBackground={null} />);
    });

    expect(backgroundImages(container!).some((image) => image.includes("old-bg.png"))).toBe(false);
  });
});

function continuityDirectorMetadata(proposedCount: number) {
  const state = applyContinuityDirectorCommand(
    createDefaultContinuityDirectorState("2026-09-03T12:00:00.000Z"),
    {
      type: "replace_director_proposals",
      arc: "The city closes in.",
      threads: ["Who stole the map?"],
      beats: ["Mara reveals the forged seal.", "The bridge guard arrives."],
    },
    { now: () => "2026-09-03T12:00:00.000Z", createId: (prefix) => `${prefix}-test` },
  );

  return {
    roleplayContinuityDirector: {
      ...state,
      beats: state.beats.map((beat, index) => ({ ...beat, status: index < proposedCount ? "proposed" : "approved" })),
    },
  };
}

function ContinuityDirectorReviewFixture({
  chatMeta,
  onOpen,
}: {
  chatMeta: ReturnType<typeof continuityDirectorMetadata>;
  onOpen: () => void;
}) {
  const count = countProposedContinuityDirectorBeats(chatMeta.roleplayContinuityDirector);
  return (
    <>
      <ContinuityDirectorReviewEntryPoint count={count} variant="desktop" onOpen={onOpen} />
      <ContinuityDirectorReviewEntryPoint count={count} variant="mobile" onOpen={onOpen} />
    </>
  );
}

describe("Continuity Director review visibility", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("renders metadata-derived desktop and mobile review entry points with accessible actions", () => {
    const onOpen = vi.fn();
    act(() => root?.render(<ContinuityDirectorReviewFixture chatMeta={continuityDirectorMetadata(1)} onOpen={onOpen} />));

    const buttons = Array.from(container!.querySelectorAll<HTMLButtonElement>("button"));
    const desktop = buttons.find((button) => button.textContent === "1");
    const mobile = buttons.find((button) => button.textContent?.includes("1 to review"));
    expect(desktop?.getAttribute("aria-label")).toBe("Continuity Director, 1 story beat to review");
    expect(desktop?.querySelector('span[aria-hidden="true"]')?.textContent).toBe("1");
    expect(mobile?.getAttribute("aria-label")).toBe("Continuity Director, 1 story beat to review");
    expect(mobile?.textContent).toContain("1 to review");

    act(() => {
      desktop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      mobile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("omits zero counts and updates both entry points when persisted metadata changes", () => {
    const onOpen = vi.fn();
    act(() => root?.render(<ContinuityDirectorReviewFixture chatMeta={continuityDirectorMetadata(0)} onOpen={onOpen} />));

    const zeroButtons = Array.from(container!.querySelectorAll<HTMLButtonElement>("button"));
    expect(zeroButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Continuity Director",
      "Continuity Director",
    ]);
    expect(zeroButtons.some((button) => button.textContent?.includes("to review"))).toBe(false);

    act(() => root?.render(<ContinuityDirectorReviewFixture chatMeta={continuityDirectorMetadata(2)} onOpen={onOpen} />));

    const updatedButtons = Array.from(container!.querySelectorAll<HTMLButtonElement>("button"));
    expect(updatedButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Continuity Director, 2 story beats to review",
      "Continuity Director, 2 story beats to review",
    ]);
    expect(updatedButtons.some((button) => button.textContent?.includes("2 to review"))).toBe(true);
  });
});
