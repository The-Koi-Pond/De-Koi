import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterPublicProfilePopover } from "./CharacterPublicProfilePopover";

const profile = {
  displayName: "The Clown",
  handle: "@clown",
  title: "Traveling performer",
  bio: "A public blurb for quick inspection.",
  tags: ["horror"],
  bannerImage: null,
  hasSavedProfile: true,
};

describe("CharacterPublicProfilePopover", () => {
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
    document.body.querySelectorAll("[data-profile-popover]").forEach((node) => node.remove());
  });

  it("renders the public profile card near the clicked identity anchor", () => {
    const onClose = vi.fn();
    const onOpenFullProfile = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={profile}
          avatarUrl="avatar://clown"
          anchorRect={{ top: 40, right: 144, bottom: 64, left: 80, width: 64, height: 24, x: 80, y: 40 }}
          onClose={onClose}
          onOpenFullProfile={onOpenFullProfile}
        />,
      );
    });

    const popover = document.body.querySelector<HTMLElement>("[data-profile-popover]");
    expect(popover).not.toBeNull();
    expect(popover!.style.top).toBe("72px");
    expect(popover!.style.left).toBe("80px");
    expect(popover!.textContent).toContain("The Clown");

    act(() => {
      popover!.querySelector<HTMLButtonElement>("button")!.click();
    });

    expect(onOpenFullProfile).toHaveBeenCalledTimes(1);
  });
});
