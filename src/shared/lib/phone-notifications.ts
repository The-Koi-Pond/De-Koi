// Phone notifications through Web Push: the hosted runner sends them when a character texts first or a reply
// finishes while no De-Koi screen is open. Browsers only allow this on HTTPS pages (or localhost).
import { phoneNotificationsApi } from "../api/phone-notifications-api";
import { LOCAL_NOTIFICATION_ACTIVATION_EVENT, type LocalNotificationActivationDetail } from "./local-notifications";

export const PUSH_SERVICE_WORKER_URL = "/push-sw.js";

export type PhoneNotificationSupport =
  | { supported: true }
  | { supported: false; reason: "insecure" | "unsupported" | "no-runner" };

export async function phoneNotificationSupport(): Promise<PhoneNotificationSupport> {
  if (typeof window === "undefined") return { supported: false, reason: "unsupported" };
  if (!window.isSecureContext) return { supported: false, reason: "insecure" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, reason: "unsupported" };
  }
  if (!(await phoneNotificationsApi.available())) return { supported: false, reason: "no-runner" };
  return { supported: true };
}

function keyBytes(base64url: string): Uint8Array {
  const base64 = base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_URL);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function phoneNotificationsEnabled(): Promise<boolean> {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) return false;
  return (await currentSubscription()) !== null;
}

/** Asks for permission, subscribes this device, and registers it with the runner. */
export async function enablePhoneNotifications(): Promise<void> {
  const support = await phoneNotificationSupport();
  if (!support.supported) throw new Error(phoneNotificationUnavailableText(support.reason));
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site.");
  const registration = await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_URL);
  await navigator.serviceWorker.ready;
  const publicKey = await phoneNotificationsApi.publicKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey) as BufferSource,
    }));
  await phoneNotificationsApi.subscribe(subscription.toJSON(), navigator.userAgent);
}

export async function disablePhoneNotifications(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await phoneNotificationsApi.unsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}

export function phoneNotificationUnavailableText(reason: "insecure" | "unsupported" | "no-runner"): string {
  if (reason === "insecure") {
    return "Phone notifications need De-Koi on an https:// address. Plain http (like http://pi:7860) can't receive them.";
  }
  if (reason === "no-runner") return "This De-Koi server can't send notifications yet (update the server).";
  return "This browser can't receive push notifications.";
}

/**
 * Opens the chat a notification was about: when a tap focuses an open tab (the service worker posts a message)
 * or opens a new one (`?openChat=` in the URL).
 */
export function listenForNotificationTaps(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const open = (chatId: string) =>
    window.dispatchEvent(
      new CustomEvent<LocalNotificationActivationDetail>(LOCAL_NOTIFICATION_ACTIVATION_EVENT, { detail: { chatId } }),
    );
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("openChat");
  if (fromUrl) {
    url.searchParams.delete("openChat");
    window.history.replaceState(window.history.state, "", url.toString());
    // Let the app mount its navigation listener first.
    window.setTimeout(() => open(fromUrl), 0);
  }
  if (!("serviceWorker" in navigator)) return () => undefined;
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; chatId?: unknown } | null;
    if (data?.type === "de-koi:open-chat" && typeof data.chatId === "string") open(data.chatId);
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
