import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64url, encryptPushPayload, fromB64url, generateVapidKeys, vapidAuthorization } from "./web-push";

describe("web push", () => {
  it("encrypts exactly like the RFC 8291 example", () => {
    // RFC 8291 section 5 / appendix A: same keys, salt and plaintext give the published message body.
    const body = encryptPushPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      {
        endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
        keys: {
          p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
          auth: "BTBZMqHH6r4Tts7J_aSIgg",
        },
      },
      {
        senderPrivateKey: fromB64url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
        salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlw"),
      },
    );
    expect(b64url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("signs a VAPID token for the push service's origin that verifies with the public key", () => {
    const keys = generateVapidKeys("mailto:notifications@example.com");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, Date.UTC(2026, 9, 19));
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
    expect(key).toBe(keys.publicKey);
    const [head, claims, signature] = token!.split(".");
    const payload = JSON.parse(fromB64url(claims!).toString()) as { aud: string; exp: number; sub: string };
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe("mailto:notifications@example.com");
    const raw = fromB64url(keys.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33)) },
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        fromB64url(signature!),
      ),
    ).toBe(true);
  });
});
