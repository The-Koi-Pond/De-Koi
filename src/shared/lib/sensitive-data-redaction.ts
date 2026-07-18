const SECRET_REPLACEMENT = "[redacted]";
const LOCAL_PATH_REPLACEMENT = "[redacted local path]";
const DATA_URI_REPLACEMENT = "[redacted data uri]";
const ENCODED_REPLACEMENT = "[redacted encoded data]";
const STACK_LINE_LIMIT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "apikey" ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "password" ||
    normalized === "passwd" ||
    normalized === "secret" ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "adminsecret" ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
}

function sensitiveUrlParam(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "key" ||
    normalized === "apikey" ||
    normalized === "token" ||
    normalized === "secret" ||
    normalized === "password" ||
    normalized.endsWith("key") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret")
  );
}

function redactUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (sensitiveUrlParam(key)) {
        url.searchParams.set(key, SECRET_REPLACEMENT);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function looksLikeEncodedBlob(value: string): boolean {
  const compact = value.trim();
  return compact.length >= 64 && /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

function redactLocalPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, LOCAL_PATH_REPLACEMENT)
    .replace(/\/(?:Users|home|var|tmp)\/[^\s"'<>|]+/g, LOCAL_PATH_REPLACEMENT);
}

function redactStack(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= STACK_LINE_LIMIT) return value;
  return [...lines.slice(0, STACK_LINE_LIMIT), "[stack truncated]"].join("\n");
}

function redactInlineSecrets(value: string): string {
  return value.replace(
    /\b(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
    (_match, key: string) => `${key}=${SECRET_REPLACEMENT}`,
  );
}

function redactString(value: string, key?: string): string {
  if (/^data:[^,]+,/i.test(value)) return DATA_URI_REPLACEMENT;
  const url = redactUrl(value);
  if (url) return url;
  if (looksLikeEncodedBlob(value)) return ENCODED_REPLACEMENT;

  let next = redactInlineSecrets(redactLocalPaths(value));
  if (key?.toLowerCase() === "stack") {
    next = redactStack(next);
  }
  return next;
}

function redactInternal(value: unknown, key: string | undefined, seen: WeakSet<object>, depth: number): unknown {
  if (key && sensitiveKey(key)) return SECRET_REPLACEMENT;
  if (typeof value === "string") return redactString(value, key);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[circular]";
  if (depth > 8) return "[max depth reached]";

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, undefined, seen, depth + 1));
  }
  if (!isRecord(value)) return value;

  const next: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    next[entryKey] = redactInternal(entryValue, entryKey, seen, depth + 1);
  }
  return next;
}

export function redactSensitiveValue(value: unknown): unknown {
  return redactInternal(value, undefined, new WeakSet<object>(), 0);
}
