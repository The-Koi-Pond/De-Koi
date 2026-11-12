// What a Roleplay chat mounts for encounters: the Encounter button above the input, and the encounter windows,
// which load on first use so chats that never fight don't download them.
import { lazy, Suspense } from "react";
import { Swords } from "lucide-react";

const EncounterHost = lazy(() => import("./EncounterHost").then((module) => ({ default: module.EncounterHost })));

export function LazyEncounterHost({ chatId }: { chatId: string }) {
  return (
    <Suspense fallback={null}>
      <EncounterHost chatId={chatId} />
    </Suspense>
  );
}

export function EncounterLauncher({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex justify-center py-1">
      <button
        type="button"
        title="Start combat encounter"
        onClick={onStart}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
      >
        <Swords size="0.875rem" aria-hidden="true" />
        Encounter
      </button>
    </div>
  );
}
