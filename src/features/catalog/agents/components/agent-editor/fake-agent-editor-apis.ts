// The recorder's fakes at the API boundary (test-fixtures/README.md, "The fakes"), for the editor tests. It
// imports nothing from the app so `vi.mock` factories can load it.

type Row = Record<string, unknown> & { id: string };
type Op =
  | "agents.list"
  | "lorebooks.list"
  | "entries.list"
  | "tools.list"
  | "agents.create"
  | "agents.update"
  | "agents.delete"
  | "connections.list"
  | "capabilities"
  | "knowledge.list"
  | "knowledge.upload"
  | "knowledge.delete"
  | "fileSave";

/** One scenario's data sets, by kind (`worlds` in a recording, decoded). */
export interface World {
  agents: Row[];
  connections: Row[];
  lorebooks: Row[];
  entries: Record<string, Row[]>;
  tools: Row[];
  capabilities: Record<string, unknown>;
  knowledge: Row[];
}

type FileResult = string | null | { throw: string };

const copy = <T>(value: T): T => structuredClone(value);

const state = {
  world: null as World | null,
  calls: [] as unknown[][],
  failures: new Map<Op, string>(),
  held: new Set<Op>(),
  waiting: new Map<Op, Array<() => void>>(),
  createNoId: false,
  confirmAnswer: true,
  fileResult: "saved" as FileResult,
  created: 0,
  uploaded: 0,
};

function world(): World {
  if (!state.world) throw new Error("fakeAgentEditorApis.reset() was not called");
  return state.world;
}

export const fakeAgentEditorApis = {
  reset(next: World) {
    state.world = copy(next);
    state.calls = [];
    state.failures.clear();
    state.held.clear();
    state.waiting.clear();
    state.createNoId = false;
    state.confirmAnswer = true;
    state.fileResult = "saved";
    state.created = 0;
    state.uploaded = 0;
  },
  /** Every fake call so far, in order, as the recorder noted them. */
  get calls(): readonly unknown[][] {
    return state.calls;
  },
  get agents(): readonly Row[] {
    return world().agents;
  },
  failNext(op: Op, message: string) {
    state.failures.set(op, message);
  },
  hold(op: Op) {
    state.held.add(op);
  },
  release(op: Op) {
    state.held.delete(op);
    const waiting = state.waiting.get(op) ?? [];
    state.waiting.delete(op);
    for (const resume of waiting) resume();
  },
  releaseAll() {
    for (const op of [...state.held, ...state.waiting.keys()]) this.release(op);
  },
  createNoId() {
    state.createNoId = true;
  },
  answerConfirm(answer: boolean) {
    state.confirmAnswer = answer;
  },
  setFileResult(result: FileResult) {
    state.fileResult = result;
  },
  setWorld<K extends keyof World>(kind: K, value: World[K]) {
    world()[kind] = copy(value);
  },
  patchAgent(id: string, patch: Record<string, unknown>) {
    const agents = world().agents;
    const index = agents.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No agent row ${id}`);
    agents[index] = { ...agents[index]!, ...copy(patch) };
  },
};

/** Waits while `op` is held, then throws a queued failure. */
async function gate(op: Op) {
  if (state.held.has(op)) {
    await new Promise<void>((resolve) => {
      state.waiting.set(op, [...(state.waiting.get(op) ?? []), resolve]);
    });
  }
  const failure = state.failures.get(op);
  if (failure !== undefined) {
    state.failures.delete(op);
    throw new Error(failure);
  }
}

const LIST_OPS: Record<string, Op> = {
  agents: "agents.list",
  lorebooks: "lorebooks.list",
  "lorebook-entries": "entries.list",
  "custom-tools": "tools.list",
};

/** Stands in for `storageApi` (only what the editor's hooks call). */
export const fakeStorageApi = {
  async list(entity: string, options?: { filters?: { lorebookId?: string } }) {
    state.calls.push(["storage.list", entity, options === undefined ? null : copy(options)]);
    const op = LIST_OPS[entity];
    if (op) await gate(op);
    const data = world();
    if (entity === "agents") return copy(data.agents);
    if (entity === "lorebooks") return copy(data.lorebooks);
    if (entity === "lorebook-entries") return copy(data.entries[options?.filters?.lorebookId ?? ""] ?? []);
    if (entity === "custom-tools") return copy(data.tools);
    return [];
  },
  async get(entity: string, id: string) {
    state.calls.push(["storage.get", entity, id]);
    return null;
  },
  async create(entity: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.create", entity, copy(payload)]);
    await gate("agents.create");
    state.created += 1;
    const stamp = "2026-01-01T00:00:00.000Z";
    const row: Row = { ...copy(payload), id: `created-agent-${state.created}`, createdAt: stamp, updatedAt: stamp };
    world().agents.push(row);
    if (state.createNoId) {
      state.createNoId = false;
      return { ok: true };
    }
    return copy(row);
  },
  async update(entity: string, id: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.update", entity, id, copy(payload)]);
    await gate("agents.update");
    const agents = world().agents;
    const index = agents.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No ${entity} row ${id}`);
    agents[index] = { ...agents[index]!, ...copy(payload), updatedAt: "2026-01-02T00:00:00.000Z" };
    return copy(agents[index]!);
  },
  async delete(entity: string, id: string) {
    state.calls.push(["storage.delete", entity, id]);
    await gate("agents.delete");
    world().agents = world().agents.filter((row) => row.id !== id);
    return null;
  },
};

export const fakeConnectionCatalogApi = {
  async listAvailable() {
    state.calls.push(["connections.list"]);
    await gate("connections.list");
    return copy(world().connections);
  },
};

export const fakeCustomToolApi = {
  async capabilities() {
    state.calls.push(["tools.capabilities"]);
    await gate("capabilities");
    return copy(world().capabilities);
  },
};

export const fakeKnowledgeSourcesApi = {
  async list() {
    state.calls.push(["knowledge.list"]);
    await gate("knowledge.list");
    return copy(world().knowledge);
  },
  async upload(file: File) {
    state.calls.push(["knowledge.upload", file]);
    await gate("knowledge.upload");
    state.uploaded += 1;
    const id = `uploaded-${state.uploaded}`;
    const row: Row = {
      id,
      originalName: file.name,
      filename: `${id}-${file.name}`,
      size: file.size,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    };
    world().knowledge.push(row);
    return copy(row);
  },
  async delete(id: string) {
    state.calls.push(["knowledge.delete", id]);
    await gate("knowledge.delete");
    world().knowledge = world().knowledge.filter((row) => row.id !== id);
    return { ok: true };
  },
};

/** Stands in for `showConfirmDialog`: records the options and gives the answer set by `answerConfirm`. */
export async function fakeConfirmDialog(options: unknown): Promise<boolean> {
  state.calls.push(["confirm", copy(options)]);
  return state.confirmAnswer;
}

/** Stands in for `saveTextFileToUserSelectedLocation`. */
export async function fakeSaveTextFile(options: unknown) {
  state.calls.push(["fileSave", copy(options)]);
  await gate("fileSave");
  const result = state.fileResult;
  if (result !== null && typeof result === "object") throw new Error(result.throw);
  return result;
}

function recordToast(kind: string) {
  return (message: unknown, options?: unknown) => {
    state.calls.push(options === undefined ? ["toast", kind, message] : ["toast", kind, message, options]);
    return kind;
  };
}

/** Stands in for sonner's `toast`. */
export const fakeToast = Object.assign(recordToast("message"), {
  success: recordToast("success"),
  error: recordToast("error"),
  info: recordToast("info"),
  warning: recordToast("warning"),
  loading: recordToast("loading"),
  promise: recordToast("promise"),
  custom: recordToast("custom"),
  dismiss: (id?: unknown) => {
    state.calls.push(["toast", "dismiss", id ?? null]);
  },
});
