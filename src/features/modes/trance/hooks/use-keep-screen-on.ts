import { useEffect, useState } from "react";

/** Why the screen can't be kept on: no wake lock over plain http, or none in this browser at all. */
export type KeepScreenOnProblem = "insecure" | "unsupported" | "refused";

export function keepScreenOnSupport(): KeepScreenOnProblem | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!("wakeLock" in navigator) || typeof navigator.wakeLock?.request !== "function") return "unsupported";
  return null;
}

/**
 * Keeps the screen from dimming or locking while `active`, and lets it go as soon as `active` turns false or the
 * component unmounts. The browser drops the lock whenever the page is hidden, so it's taken again when the page
 * comes back. Returns why it couldn't be held, or null while it is (or isn't wanted).
 */
export function useKeepScreenOn(active: boolean): KeepScreenOnProblem | null {
  const [refused, setRefused] = useState(false);
  const support = keepScreenOnSupport();

  useEffect(() => {
    if (!active || support) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    let pending = false;

    const take = () => {
      if (cancelled || pending || (sentinel && !sentinel.released) || document.visibilityState !== "visible") return;
      pending = true;
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          pending = false;
          if (cancelled) {
            void lock.release().catch(() => undefined);
            return;
          }
          sentinel = lock;
          setRefused(false);
        })
        .catch(() => {
          // Refused (battery saver, permissions policy, page not focused). Tried again when the page is shown.
          pending = false;
          if (!cancelled) setRefused(true);
        });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") take();
    };

    take();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      setRefused(false);
      document.removeEventListener("visibilitychange", onVisibility);
      // Releasing an already released lock is a no-op; a request still in flight is released when it lands.
      if (sentinel) void sentinel.release().catch(() => undefined);
    };
  }, [active, support]);

  if (!active) return null;
  return support ?? (refused ? "refused" : null);
}
