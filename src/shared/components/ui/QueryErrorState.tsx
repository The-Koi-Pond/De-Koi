import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

type QueryErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
};

export function QueryErrorState({
  title = "Something couldn't load",
  message,
  onRetry,
  retryLabel = "Retry",
  className,
  compact = false,
}: QueryErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-3 py-3 text-center text-xs text-[var(--foreground)]",
        compact ? "py-2" : "min-h-24",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 font-semibold text-[var(--destructive)]">
        <AlertCircle size="0.875rem" />
        <span>{title}</span>
      </div>
      <p className="m-0 max-w-md text-[0.75rem] leading-relaxed text-[var(--muted-foreground)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
        >
          <RefreshCw size="0.75rem" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
