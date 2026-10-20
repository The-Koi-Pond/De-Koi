import { createECDH, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushStore } from "./push-store";
import { b64url } from "./web-push";

function deviceSubscription(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) } };
}

const answering = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
const PHONE = "https://fcm.googleapis.com/fcm/send/phone";
const payload = { title: "Test", tag: "de-koi-test" };

describe("PushStore: one device's test notification", () => {
  let dir: string;
  let store: PushStore;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "de-koi-push-"));
    store = new PushStore(path.join(dir, "push.json"));
    store.subscribe(deviceSubscription(PHONE), "Pixel");
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a delivery and keeps the device", async () => {
    await expect(store.notifyOne(PHONE, payload, answering(201))).resolves.toBe("sent");
    expect(store.count).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("forgets an expired sign-up and logs the push service's answer", async () => {
    await expect(store.notifyOne(PHONE, payload, answering(410))).resolves.toBe("gone");
    expect(store.count).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 410"));
  });

  it("keeps the device and logs the status when the push service refuses", async () => {
    await expect(store.notifyOne(PHONE, payload, answering(403))).resolves.toBe("failed");
    expect(store.count).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("refused with HTTP 403"));
  });

  it("says when it doesn't know the device, without sending anything", async () => {
    const fetchImpl = answering(201);
    await expect(store.notifyOne("https://fcm.googleapis.com/fcm/send/other", payload, fetchImpl)).resolves.toBe(
      "missing",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logs refusals when notifying every device too", async () => {
    await expect(store.notifyAll(payload, answering(404))).resolves.toEqual({ sent: 0, gone: 1, failed: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 404"));
    expect(store.count).toBe(0);
  });
});
