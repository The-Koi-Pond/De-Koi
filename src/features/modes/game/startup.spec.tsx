import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGameModeStore } from "./stores/game-mode.store";
import { useExitGameSetupFromShell } from "./startup";

function ExitSetupProbe({ onReady }: { onReady: (exitSetup: () => void) => void }) {
  const exitSetup = useExitGameSetupFromShell();

  useEffect(() => {
    onReady(exitSetup);
  }, [exitSetup, onReady]);

  return null;
}

describe("useExitGameSetupFromShell", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useGameModeStore.getState().reset();
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
    useGameModeStore.getState().reset();
  });

  it("clears active game setup state through the game owner entrypoint", async () => {
    let exitSetup: (() => void) | null = null;

    act(() => {
      useGameModeStore.getState().setSetupActive(true);
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(<ExitSetupProbe onReady={(value) => (exitSetup = value)} />);
    });

    act(() => {
      exitSetup?.();
    });

    expect(useGameModeStore.getState().isSetupActive).toBe(false);
  });
});
