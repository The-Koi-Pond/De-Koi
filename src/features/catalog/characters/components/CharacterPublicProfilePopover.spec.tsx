import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CharacterPublicProfilePopover } from "./CharacterPublicProfilePopover";

const { avatarImageMock, coreModulesGetMock, dispatchMusicPlaybackEventMock, toastInfoMock } = vi.hoisted(() => ({
  avatarImageMock: vi.fn(),
  coreModulesGetMock: vi.fn(),
  dispatchMusicPlaybackEventMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock("../../../../shared/lib/music-playback-events", () => ({
  dispatchMusicPlaybackEvent: (detail: unknown) => dispatchMusicPlaybackEventMock(detail),
}));

vi.mock("../../../../shared/api/core-modules-api", () => ({
  coreModulesApi: {
    settings: {
      get: coreModulesGetMock,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    info: toastInfoMock,
  },
}));

vi.mock("../../../../shared/components/ui/AvatarImage", () => ({
  AvatarImage: (props: unknown) => {
    avatarImageMock(props);
    return <img data-avatar-image alt="" />;
  },
}));

const profile = {
  displayName: "The Clown",
  handle: "@clown",
  title: "Traveling performer",
  bio: "A public blurb for quick inspection.",
  tags: ["horror"],
  bannerImage: null,
  nowListening: null,
  nowListeningLine: null,
  musicOptions: [],
  musicPickIndex: 0,
  hasSavedProfile: true,
};

const musicProfile = {
  ...profile,
  nowListening: {
    kind: "song" as const,
    title: "Disciple",
    artist: "Throbbing Gristle",
    url: null,
    query: "Disciple Throbbing Gristle",
    displayText: "Disciple by Throbbing Gristle",
  },
  musicOptions: [
    {
      kind: "song" as const,
      title: "Disciple",
      artist: "Throbbing Gristle",
      url: null,
      query: "Disciple Throbbing Gristle",
      displayText: "Disciple by Throbbing Gristle",
    },
  ],
  musicPickIndex: 0,
  nowListeningLine: "Listening to: Disciple by Throbbing Gristle",
};

const multiMusicProfile = {
  ...musicProfile,
  musicOptions: [
    musicProfile.nowListening,
    {
      kind: "taste" as const,
      title: "Industrial ritual mix",
      artist: null,
      url: null,
      query: "industrial ritual music",
      displayText: "Industrial ritual mix",
    },
  ],
};

const originalInnerHeight = window.innerHeight;
const originalInnerWidth = window.innerWidth;

describe("CharacterPublicProfilePopover", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    avatarImageMock.mockClear();
    coreModulesGetMock.mockReset();
    dispatchMusicPlaybackEventMock.mockClear();
    toastInfoMock.mockClear();
    coreModulesGetMock.mockResolvedValue({ enabled: { "music-dj-mini-player": true } });
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
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
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

  it("keeps the popover inside the viewport when the anchor is near the bottom", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });

    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={profile}
          anchorRect={{ top: 430, right: 344, bottom: 454, left: 320, width: 24, height: 24, x: 320, y: 430 }}
          onClose={vi.fn()}
        />,
      );
    });

    const popover = document.body.querySelector<HTMLElement>("[data-profile-popover]");
    expect(popover).not.toBeNull();
    expect(popover!.style.top).toBe("8px");
    expect(popover!.style.left).toBe("32px");
    expect(popover!.style.maxHeight).toBe("448px");
  });

  it("cues character music from the mini public profile play action", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={musicProfile}
          anchorRect={{ top: 40, right: 144, bottom: 64, left: 80, width: 64, height: 24, x: 80, y: 40 }}
          onClose={vi.fn()}
        />,
      );
    });

    const play = document.body.querySelector<HTMLButtonElement>("[aria-label='Play character music']");
    expect(play).not.toBeNull();

    act(() => {
      play!.click();
    });

    expect(dispatchMusicPlaybackEventMock).toHaveBeenCalledWith({
      type: "cue",
      query: "Disciple Throbbing Gristle",
    });
  });

  it("tells users to enable the Music DJ Mini Player when public profile music is cued without it", async () => {
    coreModulesGetMock.mockResolvedValue({ enabled: { "music-dj-mini-player": false } });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={musicProfile}
          anchorRect={{ top: 40, right: 144, bottom: 64, left: 80, width: 64, height: 24, x: 80, y: 40 }}
          onClose={vi.fn()}
        />,
      );
    });

    const play = document.body.querySelector<HTMLButtonElement>("[aria-label='Play character music']");
    expect(play).not.toBeNull();

    await act(async () => {
      play!.click();
      await Promise.resolve();
    });

    expect(dispatchMusicPlaybackEventMock).toHaveBeenCalledWith({
      type: "cue",
      query: "Disciple Throbbing Gristle",
    });
    expect(toastInfoMock).toHaveBeenCalledWith(
      "Enable Music DJ Mini Player in Settings > Modules to see playback controls.",
      { duration: 5000 },
    );
  });

  it("tells users to enable the Music DJ Mini Player when delegated public profile music is played without it", async () => {
    const onPlayMusic = vi.fn();
    coreModulesGetMock.mockResolvedValue({ enabled: { "music-dj-mini-player": false } });

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={musicProfile}
          anchorRect={{ top: 40, right: 144, bottom: 64, left: 80, width: 64, height: 24, x: 80, y: 40 }}
          onClose={vi.fn()}
          onPlayMusic={onPlayMusic}
        />,
      );
    });

    const play = document.body.querySelector<HTMLButtonElement>("[aria-label='Play character music']");
    expect(play).not.toBeNull();

    await act(async () => {
      play!.click();
      await Promise.resolve();
    });

    expect(onPlayMusic).toHaveBeenCalledTimes(1);
    expect(toastInfoMock).toHaveBeenCalledWith(
      "Enable Music DJ Mini Player in Settings > Modules to see playback controls.",
      { duration: 5000 },
    );
  });

  it("shuffles between public character music options without caller-managed state", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={multiMusicProfile}
          anchorRect={{ top: 40, right: 144, bottom: 64, left: 80, width: 64, height: 24, x: 80, y: 40 }}
          onClose={vi.fn()}
        />,
      );
    });

    const shuffle = document.body.querySelector<HTMLButtonElement>("[aria-label='Shuffle character music']");
    expect(shuffle).not.toBeNull();
    expect(document.body.textContent).toContain("Disciple by Throbbing Gristle");

    act(() => {
      shuffle!.click();
    });

    expect(document.body.textContent).toContain("Industrial ritual mix");

    const play = document.body.querySelector<HTMLButtonElement>("[aria-label='Play character music']");
    act(() => {
      play!.click();
    });

    expect(dispatchMusicPlaybackEventMock).toHaveBeenCalledWith({
      type: "cue",
      query: "industrial ritual music",
    });
  });

  it("forwards crop metadata to the shared avatar renderer", () => {
    const crop = { srcX: 0.25, srcY: 0.1, srcWidth: 0.5, srcHeight: 0.7 };

    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterPublicProfilePopover
          profile={profile}
          avatarUrl="avatar://clown"
          avatarFilePath="C:/avatars/clown.png"
          avatarFilename="clown.png"
          avatarCrop={crop}
          anchorRect={{ top: 40, right: 144, bottom: 64, left: 80, width: 64, height: 24, x: 80, y: 40 }}
          onClose={vi.fn()}
        />,
      );
    });

    expect(avatarImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        src: "avatar://clown",
        avatarFilePath: "C:/avatars/clown.png",
        avatarFilename: "clown.png",
        crop,
        thumbnailSize: 128,
      }),
    );
  });
});
