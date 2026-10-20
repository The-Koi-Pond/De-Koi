// De-Koi phone notifications (Web Push). Registered only when the user turns on phone notifications.
// Push payloads are tiny: { title, body, chatId, tag }. Message text is never included.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "De-Koi";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "Open De-Koi to read it.",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { chatId: typeof data.chatId === "string" ? data.chatId : null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((entry) => new URL(entry.url).origin === self.location.origin);
      if (client) {
        await client.focus();
        if (chatId) client.postMessage({ type: "de-koi:open-chat", chatId });
        return;
      }
      await self.clients.openWindow(chatId ? `/?openChat=${encodeURIComponent(chatId)}` : "/");
    })(),
  );
});
