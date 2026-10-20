import { useEffect, useState } from "react";

/** Waits shorter than this look normal, so nothing extra is shown. */
const SHOW_ELAPSED_AFTER_SECONDS = 10;
/** After this long a wait starts to look like a hang, so say what is happening and how to stop it. */
const SLOW_AFTER_SECONDS = 30;

export const SLOW_REPLY_HINT =
  "Still waiting on the model. Slow or thinking models can take a minute or two. Press Stop to cancel.";

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * How long the current wait has run, for a step that started at `startedAt` (ms). Ticks once a second while
 * there is a wait. `elapsed` is null until the wait is long enough to be worth showing.
 */
export function useReplyWait(startedAt: number | null): { elapsed: string | null; slow: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return { elapsed: null, slow: false };
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return {
    elapsed: seconds >= SHOW_ELAPSED_AFTER_SECONDS ? formatElapsed(seconds) : null,
    slow: seconds >= SLOW_AFTER_SECONDS,
  };
}
