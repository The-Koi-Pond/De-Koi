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

describe("CharacterPublicProfileCard avatar rendering", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it("passes crop and managed file metadata to the unified avatar renderer", () => {
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

    act(() => {
      root = createRoot(container!);
      root.render(<CharacterPublicProfileCard {...props} />);
    });

    const avatar = container!.querySelector("[data-avatar-image='true']") as HTMLImageElement | null;

    expect(avatar).not.toBeNull();
    expect(avatar?.dataset.crop).toBe(JSON.stringify(avatarCrop));
    expect(avatar?.dataset.avatarFilePath).toBe("C:\\avatars\\mira.png");
    expect(avatar?.dataset.avatarFilename).toBe("mira.png");
    expect(avatar?.dataset.thumbnailSize).toBe("64");
  });
});