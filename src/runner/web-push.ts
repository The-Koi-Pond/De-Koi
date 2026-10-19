// ──────────────────────────────────────────────
// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291 / RFC 8188)
// ──────────────────────────────────────────────
// Small, dependency-free sender for the runner: phone notifications when a character texts first or a reply
// finishes while no screen is watching.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). */
  privateKey: string;
  subject: string;
}

const RECORD_SIZE = 4096;

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/\s+/g, ""), "base64url");
}

function hmac(key: Uint8Array, data: Uint8Array): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export function generateVapidKeys(subject: string): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()), subject };
}

/**
 * Encrypts `payload` for one subscription (RFC 8291 aes128gcm, one record). `senderPrivateKey` and `salt` are only
 * passed by tests (they must be random per message).
 */
export function encryptPushPayload(
  payload: Uint8Array,
  subscription: PushSubscription,
  testValues?: { senderPrivateKey: Buffer; salt: Buffer },
): Buffer {
  const uaPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Invalid push subscription keys");
  const sender = createECDH("prime256v1");
  if (testValues) sender.setPrivateKey(testValues.senderPrivateKey);
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const ecdhSecret = sender.computeSecret(uaPublic);
  const salt = testValues?.salt ?? randomBytes(16);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);

  // One record: the payload, then the 0x02 "last record" delimiter.
  if (payload.length + 1 + 16 > RECORD_SIZE) throw new Error("Push payload too large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/** `Authorization: vapid t=..., k=...` for one push service origin, valid for 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const audience = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: keys.subject })),
  );
  const publicKey = fromB64url(keys.publicKey);
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64url(publicKey.subarray(1, 33)),
      y: b64url(publicKey.subarray(33, 65)),
    },
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

export type PushResult = "sent" | "gone" | "failed";

/** Sends one notification. "gone" means the subscription expired (404/410) and should be forgotten. */
export async function sendPush(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
  keys: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const body = encryptPushPayload(Buffer.from(JSON.stringify(payload)), subscription);
  const response = await fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 60 * 60),
      Urgency: "high",
    },
    body: new Uint8Array(body),
  });
  if (response.status === 404 || response.status === 410) return "gone";
  return response.ok ? "sent" : "failed";
}
