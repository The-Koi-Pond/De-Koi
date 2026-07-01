import { describe, expect, it } from "vitest";
import worker from "./index";

function kvStore(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
  return {
    values,
    puts,
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      values.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

describe("Music DJ worker", () => {
  it("records feedback payloads in KV for ranking signals", async () => {
    const kv = kvStore();
    const response = await worker.fetch(
      new Request("https://resolver.test/v1/dj/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10" },
        body: JSON.stringify({ action: "like", track: { videoId: "abc123" } }),
      }),
      { DJ_CACHE: kv },
    );

    expect(response.status).toBe(200);
    expect(kv.puts.some((entry) => entry.key.startsWith("feedback:") && entry.value.includes("abc123"))).toBe(true);
  });

  it("rate limits repeated resolve requests from the same client", async () => {
    const minute = Math.floor(Date.now() / 60_000);
    const kv = kvStore({ [`rate:resolve:192.0.2.20:${minute}`]: "60" });
    const response = await worker.fetch(
      new Request("https://resolver.test/v1/dj/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.20" },
        body: JSON.stringify({ provider: "youtube", mode: "roleplay", sceneText: "moonlit ballroom" }),
      }),
      { YOUTUBE_API_KEY: "test-key", DJ_CACHE: kv },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ available: false, error: "rate_limited" });
  });
});