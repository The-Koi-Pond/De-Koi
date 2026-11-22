// The recorder's fakes at the API boundary (test-fixtures/README.md, "The harness"), for the replay tests. It
// imports nothing from the app so `vi.mock` factories can load it.

type Row = Record<string, unknown> & { id: string };

export type Op =
  | "prompts.get"
  | "variables.list"
  | "sections.list"
  | "groups.list"
  | "variables.create"
  | "variables.update"
  | "prompts.update"
  | "variables.delete"
  | "reorder";

/** One scenario's stored data (a recording's `worlds`, decoded). */
export interface World {
  variables: Row[];
  preset: Row;
}

const STAMP = "2026-01-02T00:00:00.000Z";

const copy = <T>(value: T): T => structuredClone(value);

const state = {
  world: null as World | null,
  calls: [] as unknown[][],
  failures: new Map<Op, string>(),
  held: new Set<Op>(),
  waiting: new Map<Op, Array<() => void>>(),
  confirmAnswer: true,
  created: 0,
};

function world(): World {
  if (!state.world) throw new Error("fakePresetVariablesApis.reset() was not called");
  return state.world;
}

export const fakePresetVariablesApis = {
  reset(next: World) {
    state.world = copy(next);
    state.calls = [];
    state.failures.clear();
    state.held.clear();
    state.waiting.clear();
    state.confirmAnswer = true;
    state.created = 0;
  },
  /** Every fake and `mutate` call so far, in order, as the recorder noted them. */
  get calls(): readonly unknown[][] {
    return state.calls;
  },
  record(call: unknown[]) {
    state.calls.push(call);
  },
  get variables(): readonly Row[] {
    return world().variables;
  },
  get preset(): Row {
    return world().preset;
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
  answerConfirm(answer: boolean) {
    state.confirmAnswer = answer;
  },
  patchVariable(id: string, patch: Record<string, unknown>) {
    const rows = world().variables;
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No variable row ${id}`);
    rows[index] = { ...rows[index]!, ...copy(patch) };
  },
  setVariables(rows: Row[]) {
    world().variables = copy(rows);
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
  "prompt-variables": "variables.list",
  "prompt-sections": "sections.list",
  "prompt-groups": "groups.list",
};

/** Stands in for `storageApi` (only what the preset hooks call). */
export const fakeStorageApi = {
  async get(entity: string, id: string) {
    state.calls.push(["storage.get", entity, id]);
    await gate("prompts.get");
    const preset = world().preset;
    return entity === "prompts" && preset.id === id ? copy(preset) : null;
  },
  async list(entity: string, options?: { filters?: { presetId?: string } }) {
    state.calls.push(["storage.list", entity, options === undefined ? null : copy(options)]);
    const op = LIST_OPS[entity];
    if (op) await gate(op);
    if (entity !== "prompt-variables") return [];
    return copy(world().variables.filter((row) => row.presetId === options?.filters?.presetId));
  },
  async create(entity: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.create", entity, copy(payload)]);
    await gate("variables.create");
    state.created += 1;
    const row: Row = { ...copy(payload), id: `created-var-${state.created}`, createdAt: STAMP, updatedAt: STAMP };
    world().variables.push(row);
    return copy(row);
  },
  async update(entity: string, id: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.update", entity, id, copy(payload)]);
    if (entity === "prompts") {
      await gate("prompts.update");
      const data = world();
      data.preset = { ...data.preset, ...copy(payload), updatedAt: STAMP };
      return copy(data.preset);
    }
    await gate("variables.update");
    const rows = world().variables;
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`Not found: ${id}`);
    rows[index] = { ...rows[index]!, ...copy(payload), updatedAt: STAMP };
    return copy(rows[index]!);
  },
  async delete(entity: string, id: string) {
    state.calls.push(["storage.delete", entity, id]);
    await gate("variables.delete");
    world().variables = world().variables.filter((row) => row.id !== id);
    return null;
  },
};

/** Stands in for `promptNestedApi`. */
export const fakePromptNestedApi = {
  async reorder(input: { presetId: string; kind: string; ids: string[] }) {
    state.calls.push(["reorder", copy(input)]);
    await gate("reorder");
    const data = world();
    const place = (row: Row) => {
      const at = input.ids.indexOf(row.id);
      return at < 0 ? Number.POSITIVE_INFINITY : at;
    };
    const mine = data.variables.filter((row) => row.presetId === input.presetId).sort((a, b) => place(a) - place(b));
    data.variables = [...data.variables.filter((row) => row.presetId !== input.presetId), ...mine];
    data.preset = { ...data.preset, variableOrder: [...input.ids] };
    return copy(mine);
  },
};

/** Stands in for `showConfirmDialog`: records the options and gives the answer set by `answerConfirm`. */
export async function fakeConfirmDialog(options: unknown): Promise<boolean> {
  state.calls.push(["confirm", copy(options)]);
  return state.confirmAnswer;
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
