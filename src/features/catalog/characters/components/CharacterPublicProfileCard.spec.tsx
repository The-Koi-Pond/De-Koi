import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterPublicProfileCard } from "./CharacterPublicProfileCard";

describe("CharacterPublicProfileCard", () => {
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
  });

  it("renders a Discord-like public profile card with an overlapping round avatar", () => {
    const onOpenFullProfile = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfileCard
          avatarUrl="avatar://clown"
          compact
          onOpenFullProfile={onOpenFullProfile}
          profile={{
            displayName: "The Clown",
            handle: "@clown",
            title: "Dead by daylight",
            bio: "A public blurb for quick chat context.",
            tags: ["dbd", "horror"],
            bannerImage: "banner://fog",
            hasSavedProfile: true,
          }}
        />,
      );
    });

    const card = container!.querySelector("[data-profile-card]");
    const avatar = container!.querySelector("[data-profile-avatar]");
    const action = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View full profile"),
    );

    expect(card).toBeTruthy();
    expect(card?.className).toContain("max-w-80");
    expect(avatar?.className).toContain("rounded-full");
    expect(container!.textContent).toContain("The Clown");
    expect(container!.textContent).toContain("@clown");
    expect(action).toBeTruthy();

    act(() => {
      action!.click();
    });

    expect(onOpenFullProfile).toHaveBeenCalledTimes(1);
  });
});
