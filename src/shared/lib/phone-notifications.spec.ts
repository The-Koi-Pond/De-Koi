import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  available: vi.fn(async () => true),
  publicKey: vi.fn(async () => "B".repeat(87)),
  subscribe: vi.fn(async () => ({ ok: true })),
  unsubscribe: vi.fn(async () => ({ ok: true })),
  test: vi.fn(),
}));
vi.mock("../api/phone-notifications-api", () => ({ phoneNotificationsApi: api }));

import { testPhoneNotifications } from "./phone-notifications";

/** The browser's push objects: one current subscription per device; subscribing again makes a new endpoint. */
function fakeBrowserPush() {
  let made = 0;
  let current: { endpoint: string; unsubscribe: () => Promise<boolean>; toJSON: () => unknown } | null = null;
  const subscribe = async () => {
    made += 1;
    const endpoint = `https://fcm.googleapis.com/fcm/send/device-${made}`;
    current = {
      endpoint,
      unsubscribe: vi.fn(async () => {
        current = null;
        return true;
      }),
      toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    };
    return current;
  };
  const registration = { pushManager: { getSubscription: async () => current, subscribe } };
  vi.stubGlobal("window", { isSecureContext: true, PushManager: class {}, Notification: {} });
  vi.stubGlobal("Notification", { requestPermission: async () => "granted" });
  vi.stubGlobal("navigator", {
    userAgent: "test-phone",
    serviceWorker: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(),
    },
  });
  return { subscribe, current: () => current };
}

describe("testPhoneNotifications", () => {
  let browser: ReturnType<typeof fakeBrowserPush>;
  beforeEach(async () => {
    browser = fakeBrowserPush();
    await browser.subscribe();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("tests this device's own subscription", async () => {
    api.test.mockResolvedValueOnce("sent");
    await expect(testPhoneNotifications()).resolves.toBeUndefined();
    expect(api.test).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/device-1");
  });

  it("signs up again and retries once when the sign-up expired", async () => {
    api.test.mockResolvedValueOnce("gone").mockResolvedValueOnce("sent");
    await expect(testPhoneNotifications()).resolves.toBeUndefined();
    expect(api.subscribe).toHaveBeenCalledWith(
      { endpoint: "https://fcm.googleapis.com/fcm/send/device-2", keys: { p256dh: "p", auth: "a" } },
      "test-phone",
    );
    expect(api.test).toHaveBeenLastCalledWith("https://fcm.googleapis.com/fcm/send/device-2");
  });

  it("signs up again when the server doesn't know this device", async () => {
    api.test.mockResolvedValueOnce("missing").mockResolvedValueOnce("sent");
    await expect(testPhoneNotifications()).resolves.toBeUndefined();
    expect(browser.current()?.endpoint).toBe("https://fcm.googleapis.com/fcm/send/device-2");
  });

  it("says what to do when the fresh sign-up is rejected too", async () => {
    api.test.mockResolvedValueOnce("gone").mockResolvedValueOnce("gone");
    await expect(testPhoneNotifications()).rejects.toThrow("Turn Phone notifications off and on again");
  });

  it("points at the server log when the push service refuses", async () => {
    api.test.mockResolvedValueOnce("failed");
    await expect(testPhoneNotifications()).rejects.toThrow("The server log says why");
    expect(api.subscribe).not.toHaveBeenCalled();
  });
});
