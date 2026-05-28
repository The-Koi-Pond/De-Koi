import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";

interface SwipeJumpControlProps {
  activeSwipeIndex: number;
  swipeCount: number;
  onSetActiveSwipe: (index: number) => void;
  onCreateNextSwipe?: () => void;
  className?: string;
  buttonClassName?: string;
  iconSize?: string;
}

export function SwipeJumpControl({
  activeSwipeIndex,
  swipeCount,
  onSetActiveSwipe,
  onCreateNextSwipe,
  className,
  buttonClassName,
  iconSize = "0.75rem",
}: SwipeJumpControlProps) {
  if (swipeCount <= 1) return null;

  const setActiveIndex = (index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), swipeCount - 1);
    if (nextIndex !== activeSwipeIndex) {
      onSetActiveSwipe(nextIndex);
    }
  };
  const isLastSwipe = activeSwipeIndex >= swipeCount - 1;
  const canCreateNextSwipe = Boolean(onCreateNextSwipe);

  return (
    <div className={cn("mari-message-swipes flex items-center gap-1.5", className)}>
      <button
        type="button"
        className={buttonClassName}
        onClick={(event) => {
          event.stopPropagation();
          setActiveIndex(activeSwipeIndex - 1);
        }}
        disabled={activeSwipeIndex <= 0}
        aria-label="Previous retry"
        title="Previous retry"
      >
        <ChevronLeft size={iconSize} />
      </button>
      <span
        className="min-w-[2.75rem] text-center tabular-nums"
        onClick={(event) => event.stopPropagation()}
        aria-label={`Retry ${activeSwipeIndex + 1} of ${swipeCount}`}
        title={`Retry ${activeSwipeIndex + 1} of ${swipeCount}`}
        aria-live="polite"
      >
        {activeSwipeIndex + 1}/{swipeCount}
      </span>
      <button
        type="button"
        className={buttonClassName}
        onClick={(event) => {
          event.stopPropagation();
          if (isLastSwipe) {
            onCreateNextSwipe?.();
            return;
          }
          setActiveIndex(activeSwipeIndex + 1);
        }}
        disabled={isLastSwipe && !canCreateNextSwipe}
        aria-label={isLastSwipe && canCreateNextSwipe ? "Generate next retry" : "Next retry"}
        title={isLastSwipe && canCreateNextSwipe ? "Generate next retry" : "Next retry"}
      >
        <ChevronRight size={iconSize} />
      </button>
    </div>
  );
}
