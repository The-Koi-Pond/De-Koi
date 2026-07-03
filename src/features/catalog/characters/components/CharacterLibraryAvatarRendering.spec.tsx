import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ParsedCharacterRow } from "../lib/character-library-model";
import { CharacterLibraryCard } from "./CharacterLibraryCard";
import { CharacterLibraryDetailCard } from "./CharacterLibraryDetailCard";

const avatarImageMock = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock("../hooks/use-start-chat-from-character", () => ({
  useStartChatFromCharacter: () => ({
    startChatFromCharacter: vi.fn(),
    isStartingChat: false,
  }),
}));

vi.mock("../lib/character-avatar-url", () => ({
  characterAvatarUrl: (character: { avatarPath?: string | null }) => character.avatarPath ?? null,
}));

vi.mock("./CharacterAvatarImage", () => ({
  CharacterAvatarImage: (props: Record<string, unknown>) => {
    avatarImageMock.props.push(props);
    return (
      <img
        src={typeof props.src === "string" ? props.src : undefined}
        alt={typeof props.alt === "string" ? props.alt : ""}
        data-character-avatar="true"
        data-thumbnail-size={props.thumbnailSize == null ? "" : String(props.thumbnailSize)}
        data-upgrade-full-resolution={String(props.upgradeToFullResolution ?? false)}
      />
    );
  },
}));

function croppedCharacter(): ParsedCharacterRow {
  return {
    id: "char-1",
    data: {},
    parsed: {
      name: "Mira Vale",
      description: "A city archivist.",
      extensions: {
        avatarCrop: { srcX: 0.2, srcY: 0.1, srcWidth: 0.5, srcHeight: 0.5 },
      },
    },
    comment: "Archivist",
    avatarPath: "asset://mira",
    avatarFilePath: "C:\\avatars\\mira.png",
    avatarFilename: "mira.png",
  };
}

describe("character library avatar rendering", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    avatarImageMock.props = [];
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

  function render(element: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(element);
    });
  }

  it("keeps cropped grid card avatars on thumbnail previews", () => {
    render(<CharacterLibraryCard character={croppedCharacter()} active={false} onSelect={vi.fn()} />);

    expect(avatarImageMock.props[0]).toMatchObject({
      thumbnailSize: 256,
    });
    expect(avatarImageMock.props[0]?.upgradeToFullResolution).not.toBe(true);
  });

  it("keeps cropped detail avatars on thumbnail previews", () => {
    render(<CharacterLibraryDetailCard character={croppedCharacter()} onEdit={vi.fn()} />);

    expect(avatarImageMock.props[0]).toMatchObject({
      thumbnailSize: 256,
    });
    expect(avatarImageMock.props[0]?.upgradeToFullResolution).not.toBe(true);
  });
});
