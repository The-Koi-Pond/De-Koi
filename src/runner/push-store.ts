// ──────────────────────────────────────────────
// Generation runner: phone notification subscriptions
// ──────────────────────────────────────────────
// Keeps the VAPID key pair and the devices that asked for notifications in one small JSON file next to the
// server's data (DE_KOI_RUNNER_DATA_DIR, default <DE_KOI_DATA_DIR>/runner). Writes go through a temp file + rename
// so a crash never leaves half a file.
import fs from "node:fs";
import path from "node:path";
import { generateVapidKeys, sendPush, type PushResult, type PushSubscription, type VapidKeys } from "./web-push";

export interface StoredSubscription extends PushSubscription {
  label: string;
  createdAt: string;
}

interface PushFile {
  version: 1;
  vapid: VapidKeys;
  subscriptions: StoredSubscription[];
}

const MAX_SUBSCRIPTIONS = 20;

function isSubscription(value: unknown): value is PushSubscription {
  if (!value || typeof value !== "object") return false;
  const record = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof record.endpoint !== "string" || !/^https:\/\//.test(record.endpoint)) return false;
  return typeof record.keys?.p256dh === "string" && typeof record.keys?.auth === "string";
}

export class PushStore {
  private data: PushFile;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  static forEnv(env: NodeJS.ProcessEnv): PushStore {
    const dir =
      env.DE_KOI_RUNNER_DATA_DIR?.trim() ||
      path.join(env.DE_KOI_DATA_DIR?.trim() || path.join(process.cwd(), "runner-data"), "runner");
    return new PushStore(path.join(dir, "push.json"));
  }

  private load(): PushFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as PushFile;
      if (parsed?.version === 1 && parsed.vapid?.publicKey && Array.isArray(parsed.subscriptions)) return parsed;
      throw new Error("unrecognized push.json");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[runner] ${this.file} is unreadable; starting fresh notification keys`, error);
      }
      const fresh: PushFile = {
        version: 1,
        vapid: generateVapidKeys("mailto:notifications@de-koi.invalid"),
        subscriptions: [],
      };
      this.write(fresh);
      return fresh;
    }
  }

  private write(data: PushFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  get publicKey(): string {
    return this.data.vapid.publicKey;
  }

  get count(): number {
    return this.data.subscriptions.length;
  }

  subscribe(subscription: unknown, label: string): void {
    if (!isSubscription(subscription)) throw new Error("Invalid push subscription");
    const others = this.data.subscriptions.filter((entry) => entry.endpoint !== subscription.endpoint);
    const next: StoredSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      label: label.slice(0, 80),
      createdAt: new Date().toISOString(),
    };
    this.data = { ...this.data, subscriptions: [...others, next].slice(-MAX_SUBSCRIPTIONS) };
    this.write(this.data);
  }

  unsubscribe(endpoint: string): boolean {
    const before = this.data.subscriptions.length;
    this.data = { ...this.data, subscriptions: this.data.subscriptions.filter((entry) => entry.endpoint !== endpoint) };
    if (this.data.subscriptions.length === before) return false;
    this.write(this.data);
    return true;
  }

  /** Sends to every device; forgets devices whose subscription expired. Returns per-result counts. */
  async notifyAll(
    payload: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
  ): Promise<Record<PushResult, number>> {
    const counts: Record<PushResult, number> = { sent: 0, gone: 0, failed: 0 };
    const gone: string[] = [];
    await Promise.all(
      this.data.subscriptions.map(async (subscription) => {
        let result: PushResult;
        try {
          result = await sendPush(subscription, payload, this.data.vapid, fetchImpl);
        } catch (error) {
          console.warn(`[runner] push to ${new URL(subscription.endpoint).host} failed`, error);
          result = "failed";
        }
        counts[result] += 1;
        if (result === "gone") gone.push(subscription.endpoint);
      }),
    );
    for (const endpoint of gone) this.unsubscribe(endpoint);
    return counts;
  }
}
