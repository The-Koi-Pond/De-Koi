import { useCallback, useRef, useState } from "react";

import type { BrowserCard, BrowserProvider, CharacterDetail } from "../lib/providers/types";

export type OpenCharacter =
  | { provider: BrowserProvider; card: BrowserCard; status: "loading" }
  | { provider: BrowserProvider; card: BrowserCard; status: "ready"; detail: CharacterDetail | null }
  | { provider: BrowserProvider; card: BrowserCard; status: "error"; error: unknown };

/**
 * The character open in place of the grid. Opening fetches its detail at once; only the newest open's reply counts,
 * so a slow reply for a character that's no longer open never lands on another one (decision 1).
 */
export function useOpenCharacter() {
  const [open, setOpen] = useState<OpenCharacter | null>(null);
  const latestOpen = useRef(0);

  const openCharacter = useCallback((provider: BrowserProvider, card: BrowserCard) => {
    const run = ++latestOpen.current;
    setOpen({ provider, card, status: "loading" });
    provider.fetchDetail(card).then(
      (detail) => {
        if (latestOpen.current === run) setOpen({ provider, card, status: "ready", detail });
      },
      (error: unknown) => {
        if (latestOpen.current === run) setOpen({ provider, card, status: "error", error });
      },
    );
  }, []);

  const close = useCallback(() => {
    latestOpen.current += 1;
    setOpen(null);
  }, []);

  return { open, openCharacter, close };
}
