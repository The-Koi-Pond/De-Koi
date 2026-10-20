import { useEffect } from "react";
import { generationRunnerHealth } from "../../shared/api/generation-runner-api";
import { phoneNotificationsApi } from "../../shared/api/phone-notifications-api";
import { listenForNotificationTaps } from "../../shared/lib/phone-notifications";
import { useUIStore } from "../../shared/stores/ui.store";

const PRESENCE_INTERVAL_MS = 60_000;

/**
 * Hosted installs: tells the server's runner whether someone is looking at De-Koi (it skips phone notifications
 * then, and uses the status for "characters text first"), and opens the chat a tapped notification was about.
 */
export function PhoneNotificationsStartup() {
  useEffect(() => listenForNotificationTaps(), []);

  useEffect(() => {
    let disposed = false;

    const report = async () => {
      if (disposed || !(await generationRunnerHealth()).ok) return;
      try {
        await phoneNotificationsApi.presence(useUIStore.getState().userStatus, document.visibilityState === "visible");
      } catch (error) {
        console.warn("[presence] could not report presence to the server", error);
      }
    };
    void report();
    const timer = setInterval(() => void report(), PRESENCE_INTERVAL_MS);
    const onVisibility = () => void report();
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = useUIStore.subscribe((state, previous) => {
      if (state.userStatus !== previous.userStatus) void report();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, []);

  return null;
}
