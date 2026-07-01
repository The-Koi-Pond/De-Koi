import { resolveMusicDjIntent } from "./resolver";
import type { MusicDjIntent, YouTubeSearchItem } from "./types";

interface Env {
  YOUTUBE_API_KEY?: string;
  DJ_CACHE?: { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function isoDurationToSeconds(value: string): number {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function clientRateLimitKey(request: Request, route: string): string {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const client = forwarded.split(",")[0]?.trim() || "unknown";
  return `rate:${route}:${client}:${Math.floor(Date.now() / 60_000)}`;
}

async function rateLimited(request: Request, env: Env, route: string, limit: number): Promise<boolean> {
  if (!env.DJ_CACHE) return false;
  const key = clientRateLimitKey(request, route);
  const count = Number((await env.DJ_CACHE.get(key)) ?? "0") || 0;
  if (count >= limit) return true;
  await env.DJ_CACHE.put(key, String(count + 1), { expirationTtl: 90 });
  return false;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function recordFeedback(request: Request, env: Env): Promise<Response> {
  if (await rateLimited(request, env, "feedback", 120)) {
    return json({ success: false, error: "rate_limited" }, 429);
  }
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return json({ success: false, error: "invalid_feedback" }, 400);
  await env.DJ_CACHE?.put(
    `feedback:${Date.now()}:${crypto.randomUUID()}`,
    JSON.stringify({ receivedAt: new Date().toISOString(), body }),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );
  return json({ success: true });
}

async function youtubeSearch(query: string, intent: MusicDjIntent, env: Env): Promise<YouTubeSearchItem[]> {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");
  const cacheKey = `resolve:${JSON.stringify({ query, intent })}`;
  const cached = await env.DJ_CACHE?.get(cacheKey);
  if (cached) return JSON.parse(cached) as YouTubeSearchItem[];

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("maxResults", "12");
  searchUrl.searchParams.set("safeSearch", "none");
  searchUrl.searchParams.set("videoEmbeddable", "true");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("key", env.YOUTUBE_API_KEY);
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) throw new Error(`YouTube search returned ${searchResponse.status}`);
  const searchJson = (await searchResponse.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; default?: { url?: string } } } }> };
  const ids = (searchJson.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "contentDetails,status,snippet");
  videosUrl.searchParams.set("id", ids.join(","));
  videosUrl.searchParams.set("key", env.YOUTUBE_API_KEY);
  const videosResponse = await fetch(videosUrl);
  if (!videosResponse.ok) throw new Error(`YouTube videos returned ${videosResponse.status}`);
  const videosJson = (await videosResponse.json()) as { items?: Array<{ id?: string; contentDetails?: { duration?: string }; status?: { embeddable?: boolean }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; default?: { url?: string } } } }> };
  const items = (videosJson.items ?? []).map((item) => ({
    videoId: item.id ?? "",
    title: item.snippet?.title ?? "Untitled YouTube track",
    channel: item.snippet?.channelTitle ?? "YouTube",
    durationSeconds: isoDurationToSeconds(item.contentDetails?.duration ?? ""),
    thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? "",
    embeddable: item.status?.embeddable === true,
  })).filter((item) => item.videoId);
  await env.DJ_CACHE?.put(cacheKey, JSON.stringify(items), { expirationTtl: 60 * 60 * 12 });
  return items;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/dj/health") {
      return json({ ok: true, provider: "youtube", configured: Boolean(env.YOUTUBE_API_KEY) });
    }
    if (request.method === "POST" && url.pathname === "/v1/dj/feedback") {
      return recordFeedback(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/dj/resolve") {
      if (await rateLimited(request, env, "resolve", 60)) {
        return json({ available: false, provider: "youtube", tracks: [], error: "rate_limited" }, 429);
      }
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object") {
        return json({ available: false, provider: "youtube", tracks: [], error: "invalid_intent" }, 400);
      }
      const intent = body as MusicDjIntent;
      return json(await resolveMusicDjIntent(intent, { search: (query, input) => youtubeSearch(query, input, env) }));
    }
    return json({ error: "not_found" }, 404);
  },
};