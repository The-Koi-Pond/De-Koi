import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterPublicProfileCard } from "./CharacterPublicProfileCard";

vi.mock("../../../../shared/components/ui/AvatarImage", () => ({
  AvatarImage: ({
    src,
    alt,
    crop,
    avatarFilePath,
    avatarFilename,
    thumbnailSize,
  }: {
    src?: string | null;
    alt: string;
    crop?: unknown;
    avatarFilePath?: string | null;
    avatarFilename?: string | null;
    thumbnailSize?: number;
  }) => (
    <img
      src={src ?? undefined}
      alt={alt}
      data-avatar-image="true"
      data-crop={JSON.stringify(crop ?? null)}
      data-avatar-file-path={avatarFilePath ?? ""}
      data-avatar-filename={avatarFilename ?? ""}
      data-thumbnail-size={thumbnailSize ?? ""}
    />
  ),
}));

describe("CharacterPublicProfileCard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it("renders profile avatars through the unified avatar renderer with crop metadata", () => {
    const avatarCrop = { srcX: 0.2, srcY: 0.1, srcWidth: 0.5, srcHeight: 0.5 };
    const props = {
      profile: {
        displayName: "Mira Vale",
        handle: "@mira",
        title: "Archivist",
        bio: "Keeps the keys.",
        tags: [],
        bannerImage: null,
        hasSavedProfile: true,
      },
      avatarUrl: "asset://mira-full",
      avatarFilePath: "C:\\avatars\\mira.png",
      avatarFilename: "mira.png",
      avatarCrop,
      compact: true,
    } as unknown as ComponentProps<typeof CharacterPublicProfileCard>;

    container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container!);
      root.render(<CharacterPublicProfileCard {...props} />);
    });

    const avatar = container.querySelector("[data-avatar-image='true']") as HTMLImageElement | null;

    expect(avatar).not.toBeNull();
    expect(avatar?.dataset.crop).toBe(JSON.stringify(avatarCrop));
    expect(avatar?.dataset.avatarFilePath).toBe("C:\\avatars\\mira.png");
    expect(avatar?.dataset.avatarFilename).toBe("mira.png");
    expect(avatar?.dataset.thumbnailSize).toBe("128");
  });

  it("renders music presence and hides music actions when handlers are absent", () => {
    const props = {
      profile: {
        displayName: "Mira Vale",
        handle: "@mira",
        title: "Archivist",
        bio: "Keeps the keys.",
        tags: [],
        bannerImage: null,
        hasSavedProfile: true,
        nowListening: {
          kind: "song",
          title: "Promise",
          artist: "Akira Yamaoka",
          url: null,
          query: "Promise Akira Yamaoka",
          displayText: "Promise by Akira Yamaoka",
        },
        nowListeningLine: "Listening to: Promise by Akira Yamaoka",
      },
    } as unknown as ComponentProps<typeof CharacterPublicProfileCard>;

    container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container!);
      root.render(<CharacterPublicProfileCard {...props} />);
    });

    expect(container.textContent).toContain("Listening to:");
    expect(container.textContent).toContain("Promise by Akira Yamaoka");
    expect(container.querySelector("[aria-label='Shuffle character music']")).toBeNull();
    expect(container.querySelector("[aria-label='Play character music']")).toBeNull();
  });

  it("calls music shuffle and play handlers when provided", () => {
    const onShuffleMusic = vi.fn();
    const onPlayMusic = vi.fn();
    const props = {
      profile: {
        displayName: "Mira Vale",
        handle: "@mira",
        title: "Archivist",
        bio: "Keeps the keys.",
        tags: [],
        bannerImage: null,
        hasSavedProfile: true,
        nowListening: {
          kind: "song",
          title: "Promise",
          artist: "Akira Yamaoka",
          url: null,
          query: "Promise Akira Yamaoka",
          displayText: "Promise by Akira Yamaoka",
        },
        nowListeningLine: "Listening to: Promise by Akira Yamaoka",
      },
      onShuffleMusic,
      onPlayMusic,
    } as unknown as ComponentProps<typeof CharacterPublicProfileCard>;

    container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container!);
      root.render(<CharacterPublicProfileCard {...props} />);
    });

    const shuffle = container.querySelector("[aria-label='Shuffle character music']") as HTMLButtonElement | null;
    const play = container.querySelector("[aria-label='Play character music']") as HTMLButtonElement | null;

    expect(shuffle).not.toBeNull();
    expect(play).not.toBeNull();
    act(() => shuffle?.click());
    act(() => play?.click());
    expect(onShuffleMusic).toHaveBeenCalledTimes(1);
    expect(onPlayMusic).toHaveBeenCalledTimes(1);
  });
});

