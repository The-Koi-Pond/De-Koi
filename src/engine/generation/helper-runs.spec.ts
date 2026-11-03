import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { backgroundConnectionRule } from "./background-llm-connection";
import {
  HELPER_RUNS_PER_TASK,
  chatConnectionRule,
  describeHelperRun,
  findHelperRun,
  helperRunSettingsId,
  noteHelperRun,
  readHelperRuns,
  resolveHelperRoute,
  type HelperRun,
} from "./helper-runs";
import type { JsonRecord } from "./runtime-records";

const CONNECTIONS: JsonRecord[] = [
  { id: "strong", name: "Strong", provider: "anthropic", model: "big-model" },
  { id: "cheap", name: "Cheap", provider: "openai", model: "small-model" },
];

function memoryStorage(options: { routes?: Record<string, string>; localOnly?: string[]; cas?: boolean } = {}) {
  const rows = new Map<string, JsonRecord>();
  if (options.routes) {
    rows.set("app-settings:model-routing", {
      id: "model-routing",
      value: { version: 1, routes: options.routes, localOnly: options.localOnly },
    });
  }
  const key = (entity: StorageEntity, id: string) => `${entity}:${id}`;
  const storage = {
    get: vi.fn(async (entity: StorageEntity, id: string) => {
      if (entity === "connections") return CONNECTIONS.find((connection) => connection.id === id) ?? null;
      return rows.get(key(entity, id)) ?? null;
    }),
    list: vi.fn(async (entity: StorageEntity) => (entity === "connections" ? CONNECTIONS : [])),
    create: vi.fn(async (entity: StorageEntity, value: JsonRecord) => {
      const id = String(value.id);
      if (rows.has(key(entity, id))) throw new Error(`${entity}/${id} already exists`);
      rows.set(key(entity, id), value);
      return value;
    }),
    update: vi.fn(async (entity: StorageEntity, id: string, patch: JsonRecord) => {
      const next = { ...rows.get(key(entity, id)), ...patch };
      rows.set(key(entity, id), next);
      return next;
    }),
    ...(options.cas === false
      ? {}
      : {
          updateAppSettingsIfUnchanged: vi.fn(async (id: string, expected: unknown, value: unknown) => {
            const current = rows.get(key("app-settings", id));
            if (JSON.stringify(current?.value ?? null) !== JSON.stringify(expected)) {
              return { updated: false, record: current };
            }
            const next = { ...current, id, value };
            rows.set(key("app-settings", id), next);
            return { updated: true, record: next };
          }),
        }),
  };
  return { storage: storage as unknown as StorageGateway & typeof storage, rows };
}

function at(minute: number) {
  return () => new Date(Date.UTC(2026, 9, 23, 12, minute));
}

afterEach(() => vi.restoreAllMocks());

describe("noteHelperRun", () => {
  it("saves where a helper ran and why, reading the connection's name and model by id", async () => {
    const { storage } = memoryStorage();
    await noteHelperRun(storage, {
      task: "fanficChecks",
      rule: "route",
      connectionId: "cheap",
      job: "story ledger",
      chatId: "fic-1",
      now: at(1),
    });

    const runs = await readHelperRuns(storage);
    expect(runs.fanficChecks).toEqual([
      {
        version: 1,
        task: "fanficChecks",
        job: "story ledger",
        chatId: "fic-1",
        at: "2026-10-23T12:01:00.000Z",
        connectionId: "cheap",
        connectionName: "Cheap",
        model: "small-model",
        rule: "route",
        problem: null,
      },
    ]);
    expect(runs.memory).toBeUndefined();
  });

  it("keeps the newest run per job, newest first, and caps the list", async () => {
    const { storage } = memoryStorage();
    await noteHelperRun(storage, {
      task: "fanficChecks",
      rule: "chat",
      connectionId: "strong",
      job: "story ledger",
      now: at(1),
    });
    await noteHelperRun(storage, {
      task: "fanficChecks",
      rule: "route",
      connectionId: "cheap",
      job: "editor pass",
      now: at(2),
    });
    await noteHelperRun(storage, {
      task: "fanficChecks",
      rule: "route",
      connectionId: "cheap",
      job: "story ledger",
      now: at(3),
    });

    const runs = (await readHelperRuns(storage)).fanficChecks ?? [];
    expect(runs.map((run) => [run.job, run.rule, run.at.slice(11, 16)])).toEqual([
      ["story ledger", "route", "12:03"],
      ["editor pass", "route", "12:02"],
    ]);

    for (let index = 0; index < HELPER_RUNS_PER_TASK + 3; index += 1) {
      await noteHelperRun(storage, {
        task: "interpretations",
        rule: "chat",
        connectionId: "strong",
        job: `Character ${index}`,
        now: at(10 + index),
      });
    }
    const reads = (await readHelperRuns(storage)).interpretations ?? [];
    expect(reads).toHaveLength(HELPER_RUNS_PER_TASK);
    expect(reads[0]?.job).toBe(`Character ${HELPER_RUNS_PER_TASK + 2}`);
  });

  it("keeps both runs when two helpers of one task save at the same moment", async () => {
    const { storage } = memoryStorage();
    await Promise.all([
      noteHelperRun(storage, {
        task: "fanficChecks",
        rule: "chat",
        connectionId: "strong",
        job: "story ledger",
        now: at(1),
      }),
      noteHelperRun(storage, {
        task: "fanficChecks",
        rule: "route",
        connectionId: "cheap",
        job: "editor pass",
        now: at(1),
      }),
    ]);
    const jobs = ((await readHelperRuns(storage)).fanficChecks ?? []).map((run) => run.job).sort();
    expect(jobs).toEqual(["editor pass", "story ledger"]);
  });

  it("falls back to a plain update on a runtime without compare-and-set", async () => {
    const { storage } = memoryStorage({ cas: false });
    await noteHelperRun(storage, { task: "status", rule: "chat", connectionId: "strong", now: at(1) });
    await noteHelperRun(storage, { task: "status", rule: "route", connectionId: "cheap", now: at(2) });
    expect((await readHelperRuns(storage)).status?.map((run) => run.connectionName)).toEqual(["Cheap"]);
  });

  it("names the Local Model, and keeps an unknown connection's id as its name", async () => {
    const { storage } = memoryStorage();
    await noteHelperRun(storage, {
      task: "memory",
      rule: "route",
      connectionId: "sidecar:local",
      job: "a",
      now: at(1),
    });
    await noteHelperRun(storage, { task: "memory", rule: "chat", connectionId: "gone", job: "b", now: at(2) });
    const [gone, local] = (await readHelperRuns(storage)).memory ?? [];
    expect(local).toMatchObject({ connectionName: "Local Model", model: "" });
    expect(gone).toMatchObject({ connectionName: "gone", connectionId: "gone" });
  });

  it("logs a note it can't save instead of failing the helper", async () => {
    const { storage } = memoryStorage();
    storage.create.mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      noteHelperRun(storage, { task: "summaries", rule: "chat", connectionId: "strong", now: at(1) }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[helper-models] Couldn't save the Summaries helper's last run.",
      expect.objectContaining({ message: "disk full" }),
    );
  });
});

describe("readHelperRuns", () => {
  it("skips runs it can't read", async () => {
    const { storage, rows } = memoryStorage();
    rows.set(`app-settings:${helperRunSettingsId("schedules")}`, {
      id: helperRunSettingsId("schedules"),
      value: {
        version: 1,
        runs: [
          { task: "schedules", rule: "made-up", at: "2026-10-23T12:00:00.000Z" },
          { task: "status", rule: "chat", at: "2026-10-23T12:00:00.000Z" },
          { task: "schedules", rule: "chat", at: "not a date" },
          { task: "schedules", rule: "chat", at: "2026-10-23T12:00:00.000Z", connectionId: "strong" },
        ],
      },
    });
    expect((await readHelperRuns(storage)).schedules?.map((run) => run.connectionId)).toEqual(["strong"]);
  });
});

describe("resolveHelperRoute", () => {
  it("returns null without noting anything when the task is not routed", async () => {
    const { storage } = memoryStorage({ routes: {} });
    await expect(resolveHelperRoute(storage, "fanficPlanning")).resolves.toBeNull();
    expect(storage.create).not.toHaveBeenCalled();
  });

  it("returns the routed connection and leaves the note to the caller", async () => {
    const { storage } = memoryStorage({ routes: { fanficPlanning: "cheap" } });
    await expect(resolveHelperRoute(storage, "fanficPlanning")).resolves.toMatchObject({ id: "cheap" });
    expect(storage.create).not.toHaveBeenCalled();
  });

  it("notes a broken route as the reason the helper stopped, then throws", async () => {
    const { storage } = memoryStorage({ routes: { fanficChecks: "deleted" } });
    await expect(
      resolveHelperRoute(storage, "fanficChecks", { job: "story ledger", chatId: "fic-1" }),
    ).rejects.toMatchObject({ code: "route_unavailable" });
    const [run] = (await readHelperRuns(storage)).fanficChecks ?? [];
    expect(run).toMatchObject({ job: "story ledger", chatId: "fic-1", connectionId: "deleted", rule: "route" });
    expect(describeHelperRun(run!)).toBe(
      'Stopped (story ledger): The Fanfic checks helper is set to a connection that no longer exists. Pick another connection, or "Same as today", in Connections → Helper Models.',
    );
  });

  it("notes a local-only task with no local route", async () => {
    const { storage } = memoryStorage({ routes: {}, localOnly: ["fanficPlanning"] });
    await expect(resolveHelperRoute(storage, "fanficPlanning", { job: "outline" })).rejects.toMatchObject({
      problem: "no_local_route",
    });
    expect((await readHelperRuns(storage)).fanficPlanning?.[0]?.problem).toContain("must stay on your device");
  });
});

describe("describeHelperRun", () => {
  const run = (patch: Partial<HelperRun>): HelperRun => ({
    version: 1,
    task: "fanficPlanning",
    job: "outline",
    chatId: "fic-1",
    at: "2026-10-23T12:00:00.000Z",
    connectionId: "cheap",
    connectionName: "Cheap",
    model: "small-model",
    rule: "route",
    problem: null,
    ...patch,
  });

  it("says where it ran and why", () => {
    expect(describeHelperRun(run({}))).toBe(
      "Ran (outline) on Cheap • small-model: your Helper Models pick for Fanfic planning.",
    );
    expect(describeHelperRun(run({ rule: "chat" }))).toBe(
      "Ran (outline) on Cheap • small-model: this fic's connection (Fanfic planning has no Helper Models pick).",
    );
    expect(describeHelperRun(run({ task: "status", job: "", rule: "chat", model: "" }))).toBe(
      "Ran on Cheap: the chat's connection (Status blurbs has no Helper Models pick).",
    );
    expect(describeHelperRun(run({ task: "judge", job: "", rule: "lastJudge" }))).toBe(
      "Ran on Cheap • small-model: this fic's last judge, so scores stay comparable.",
    );
    expect(describeHelperRun(run({ task: "memory", job: "", rule: "agentDefault" }))).toBe(
      "Ran on Cheap • small-model: Default for Agents (Memory has no Helper Models pick).",
    );
  });

  it("finds one job's run in one chat", () => {
    const runs = {
      fanficChecks: [
        run({ task: "fanficChecks", job: "editor pass" }),
        run({ task: "fanficChecks", job: "story ledger", chatId: "fic-2" }),
      ],
    };
    expect(findHelperRun(runs, "fanficChecks", { job: "story ledger", chatId: "fic-2" })?.chatId).toBe("fic-2");
    expect(findHelperRun(runs, "fanficChecks", { job: "story ledger", chatId: "fic-1" })).toBeNull();
    expect(findHelperRun(runs, "fanficChecks", { chatId: "fic-1" })?.job).toBe("editor pass");
    expect(findHelperRun(undefined, "fanficChecks", {})).toBeNull();
  });
});

describe("fallback rules", () => {
  it("names the step of the background pick that chose the connection", () => {
    expect(backgroundConnectionRule({ id: "a", defaultForAgents: true }, "chat")).toBe("agentDefault");
    expect(backgroundConnectionRule({ id: "chat" }, "chat")).toBe("chat");
    expect(backgroundConnectionRule({ id: "b", isDefault: true }, "chat")).toBe("appDefault");
    expect(backgroundConnectionRule({ id: "c" }, "chat")).toBe("first");
  });

  it("names the chat's connection, its random pool, then the defaults", () => {
    expect(chatConnectionRule({ id: "chat" }, null, "chat")).toBe("chat");
    expect(chatConnectionRule({ id: "pooled", useForRandom: true }, "random")).toBe("chat");
    expect(chatConnectionRule({ id: "d", default: true }, "chat")).toBe("appDefault");
    expect(chatConnectionRule({ id: "e" }, "")).toBe("first");
  });
});
