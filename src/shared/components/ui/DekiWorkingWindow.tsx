import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

const DOTTOR_SUPPORT_GIF = "/sprites/dottore/dottore_jumping.gif";

interface DekiWorkingWindowProps {
  visible: boolean;
  className?: string;
}

export function DekiWorkingWindow({ visible, className }: DekiWorkingWindowProps) {
  const [dismissed, setDismissed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (visible) {
      setDismissed(false);
      setImageFailed(false);
    }
  }, [visible]);

  if (!visible || dismissed) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[10000] w-[calc(100vw-2rem)] max-w-64 -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-2xl animate-in fade-in slide-in-from-bottom-2 sm:bottom-5 sm:left-auto sm:right-5 sm:w-64 sm:translate-x-0",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        title="Close"
      >
        <X size="0.8125rem" />
      </button>
      <div className="flex flex-col items-center gap-3 px-4 pb-4 pt-5 text-center">
        {!imageFailed && (
          <img
            src={DOTTOR_SUPPORT_GIF}
            alt="Dottore providing moral support"
            className="h-28 w-28 object-contain [image-rendering:pixelated]"
            onError={() => setImageFailed(true)}
          />
        )}
        <p className="text-xs font-medium leading-relaxed">
          Deki-senpai is working (and Dottore is providing moral support)…
        </p>
      </div>
    </div>
  );
}
