import { lazy, Suspense, type ComponentProps } from "react";
import { Sparkles } from "lucide-react";

import { cn } from "../../../../../shared/lib/utils";

// The picker (and the fic and trance engines behind it) loads when someone opens it, not with the chat screen.
const MakeFromThisDialogLazy = lazy(() =>
  import("./MakeFromThis").then((module) => ({ default: module.MakeFromThisDialog })),
);

/** The "Make from this" picker; renders nothing until it is first opened. */
export function MakeFromThisDialog(props: ComponentProps<typeof MakeFromThisDialogLazy>) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <MakeFromThisDialogLazy {...props} />
    </Suspense>
  );
}

/** A labelled top-bar button: turn this chat, roleplay or fic into another kind of story. */
export function MakeFromThisButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Make a fic, trance and more from this"
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] backdrop-blur-md transition-colors hover:bg-[var(--primary)]/25",
        className,
      )}
    >
      <Sparkles size="0.875rem" className="text-[var(--primary)]" aria-hidden="true" />
      Make from this
    </button>
  );
}
