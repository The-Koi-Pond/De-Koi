import { Plug } from "lucide-react";

import { useUIStore } from "../../../../shared/stores/ui.store";

export function GameShowcaseBanner() {
  const openRightPanel = useUIStore((state) => state.openRightPanel);

  return (
    <div className="pointer-events-auto mx-auto mb-2 flex w-[min(42rem,calc(100%-1rem))] flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/30 bg-zinc-950/82 px-3 py-2 text-xs text-amber-50 shadow-lg backdrop-blur">
      <div className="min-w-0">
        <p className="font-semibold">You are exploring a sample world without a model connection.</p>
        <p className="mt-0.5 text-amber-50/75">
          Browse the map, journal, party, and state. Connect a model when you want De-Koi to generate the next turn.
        </p>
      </div>
      <button
        type="button"
        onClick={() => openRightPanel("connections")}
        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-amber-200/30 bg-amber-200/12 px-2.5 py-1 font-medium text-amber-50 transition-colors hover:bg-amber-200/20"
      >
        <Plug size="0.8rem" aria-hidden />
        Open Connections
      </button>
    </div>
  );
}
