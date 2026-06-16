import { useCallback } from "react";
import { useGameModeStore } from "./stores/game-mode.store";

export function useExitGameSetupFromShell() {
  const setSetupActive = useGameModeStore((state) => state.setSetupActive);
  return useCallback(() => setSetupActive(false), [setSetupActive]);
}
