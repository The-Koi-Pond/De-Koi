// In-memory storage behind the custom tool hooks for the editor tests, as test-fixtures/README.md describes
// the recorder's fake. It imports nothing from the app so `vi.mock` factories can load it.

type Row = Record<string, unknown> & { id: string };
type Operation = "create" | "update" | "delete";

const copy = <T>(value: T): T => structuredClone(value);

const state = {
  rows: [] as Row[],
  calls: [] as unknown[][],
  failures: new Map<Operation, string>(),
  holding: false,
  release: null as (() => void) | null,
  createNoId: false,
  confirmAnswer: true,
  created: 0,
};

export const fakeToolStorage = {
  reset(rows: readonly Row[]) {
    state.rows = copy([...rows]);
    state.calls = [];
    state.failures.clear();
    state.holding = false;
    state.release = null;
    state.createNoId = false;
    state.confirmAnswer = true;
    state.created = 0;
  },
  /** Every storage call and confirm dialog so far, in order. */
  get calls(): readonly unknown[][] {
    return state.calls;
  },
  get rows(): readonly Row[] {
    return state.rows;
  },
  /** The next `op` throws `new Error(message)`. */
  failNext(op: Operation, message: string) {
    state.failures.set(op, message);
  },
  /** The next create or update waits until `release()`. */
  hold() {
    state.holding = true;
  },
  release() {
    const release = state.release;
    state.release = null;
    release?.();
  },
  /** The next create returns `{ ok: true }` (no id). */
  createNoId() {
    state.createNoId = true;
  },
  /** Stores a row behind the editor's back, as another tab would (seen after the next list). */
  insertRow(row: Row) {
    state.rows.push(copy(row));
  },
  /** Changes a stored row behind the editor's back (seen after the next list). */
  patchRow(id: string, patch: Record<string, unknown>) {
    const index = state.rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No row ${id}`);
    state.rows[index] = { ...state.rows[index]!, ...copy(patch) };
  },
  answerConfirm(answer: boolean) {
    state.confirmAnswer = answer;
  },
};

async function gate(op: Operation) {
  if (op !== "delete" && state.holding) {
    state.holding = false;
    await new Promise<void>((resolve) => {
      state.release = resolve;
    });
  }
  const failure = state.failures.get(op);
  if (failure !== undefined) {
    state.failures.delete(op);
    throw new Error(failure);
  }
}

/** Stands in for `storageApi` (only what the editor's hooks call). */
export const fakeStorageApi = {
  async list(entity: string, options?: unknown) {
    state.calls.push(["list", entity, options ?? null]);
    return entity === "custom-tools" ? copy(state.rows) : [];
  },
  async get(entity: string, id: string, options?: unknown) {
    state.calls.push(["get", entity, id, options ?? null]);
    return copy(state.rows.find((row) => row.id === id) ?? null);
  },
  async create(entity: string, payload: Record<string, unknown>) {
    state.calls.push(["create", entity, copy(payload)]);
    await gate("create");
    state.created += 1;
    const row: Row = {
      ...payload,
      id: `created-${state.created}`,
      createdAt: "2025-02-01T00:00:00Z",
      updatedAt: "2025-02-01T00:00:00Z",
    };
    state.rows.push(row);
    if (state.createNoId) {
      state.createNoId = false;
      return { ok: true };
    }
    return copy(row);
  },
  async update(entity: string, id: string, patch: Record<string, unknown>) {
    state.calls.push(["update", entity, id, copy(patch)]);
    await gate("update");
    const index = state.rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No ${entity} row ${id}`);
    state.rows[index] = { ...state.rows[index]!, ...patch };
    return copy(state.rows[index]!);
  },
  async delete(entity: string, id: string) {
    state.calls.push(["delete", entity, id]);
    await gate("delete");
    state.rows = state.rows.filter((row) => row.id !== id);
  },
};

/** Stands in for `showConfirmDialog`: records the options and gives the answer set by `answerConfirm`. */
export async function fakeConfirmDialog(options: unknown): Promise<boolean> {
  state.calls.push(["confirm", copy(options)]);
  return state.confirmAnswer;
}
