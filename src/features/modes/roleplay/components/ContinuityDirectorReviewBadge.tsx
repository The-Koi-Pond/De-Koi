export function continuityDirectorReviewLabel(count: number) {
  return `${count} story ${count === 1 ? "beat" : "beats"} to review`;
}

export function ContinuityDirectorReviewBadge({
  count,
  compact = false,
  decorative = false,
}: {
  count: number;
  compact?: boolean;
  decorative?: boolean;
}) {
  if (count <= 0) return null;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : continuityDirectorReviewLabel(count)}
      className={
        compact
          ? "absolute -right-1 -top-1 min-w-4 rounded-full bg-[var(--primary)] px-1 text-center text-[0.5625rem] font-bold text-[var(--primary-foreground)]"
          : "ml-auto rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--primary)]"
      }
    >
      {compact ? count : `${count} to review`}
    </span>
  );
}
