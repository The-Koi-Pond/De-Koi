// The recorder's fakes at the API boundary (test-fixtures/README.md, "The harness"), for the replay tests. It
// imports nothing from the app so `vi.mock` factories can load it.

type Row = Record<string, unknown> & { id: string };

type Kind = "sections" | "groups" | "variables";

export type Op =
  | "prompts.get"
  | "prompts.update"
  | `${Kind}.list`
  | `${Kind}.create`
  | `${Kind}.update`
  | `${Kind}.delete`
  | "agents.list"
  | "reorder";

/** One scenario's stored data (a recording's `worlds`, decoded). */
export interface World {
  sections: Row[];
  groups: Row[];
  variables: Row[];
  agents: Row[];
  presets: Row[];
  storage: { data: Record<string, string>; throwGet?: boolean; throwSet?: boolean };
}

const STAMP = "2026-01-02T00:00:00.000Z";

const ENTITY_KIND: Record<string, Kind> = {
  "prompt-sections": "sections",
  "prompt-groups": "groups",
  "prompt-variables": "variables",
};

const CREATED_PREFIX: Record<Kind, string> = {
  sections: "created-sec",
  groups: "created-grp",
  variables: "created-var",
};

const ORDER_KEY: Record<Kind, string> = {
  sections: "sectionOrder",
  groups: "groupOrder",
  variables: "variableOrder",
};

const copy = <T>(value: T): T => structuredClone(value);

const state = {
  world: null as World | null,
  calls: [] as unknown[][],
  failures: new Map<Op, string>(),
  held: new Set<Op>(),
  waiting: new Map<Op, Array<() => void>>(),
  confirmAnswer: true,
  created: { sections: 0, groups: 0, variables: 0 } as Record<Kind, number>,
  noIdNext: new Set<Kind>(),
  storage: new Map<string, string>(),
};

function world(): World {
  if (!state.world) throw new Error("fakePresetSectionsApis.reset() was not called");
  return state.world;
}

export const fakePresetSectionsApis = {
  reset(next: World) {
    state.world = copy(next);
    state.calls = [];
    state.failures.clear();
    state.held.clear();
    state.waiting.clear();
    state.confirmAnswer = true;
    state.created = { sections: 0, groups: 0, variables: 0 };
    state.noIdNext.clear();
    state.storage = new Map(Object.entries(next.storage.data));
  },
  /** Every fake and `mutate` call so far, in order, as the recorder noted them. */
  get calls(): readonly unknown[][] {
    return state.calls;
  },
  record(call: unknown[]) {
    state.calls.push(call);
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
  createNoId(kind: Kind) {
    state.noIdNext.add(kind);
  },
  patchSection(id: string, patch: Record<string, unknown>) {
    const rows = world().sections;
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No section row ${id}`);
    rows[index] = { ...rows[index]!, ...copy(patch) };
  },
  /** Replaces the stored `preset-1` sections. */
  setSections(rows: Row[]) {
    const data = world();
    data.sections = [...data.sections.filter((row) => row.presetId !== "preset-1"), ...copy(rows)];
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

function presetRow(id: string): Row | undefined {
  return world().presets.find((row) => row.id === id);
}

/** Stands in for `storageApi` (only what the preset and agent hooks call). */
export const fakeStorageApi = {
  async get(entity: string, id: string) {
    state.calls.push(["storage.get", entity, id]);
    await gate("prompts.get");
    const preset = entity === "prompts" ? presetRow(id) : undefined;
    return preset ? copy(preset) : null;
  },
  async list(entity: string, options?: { filters?: { presetId?: string } }) {
    state.calls.push(["storage.list", entity, options === undefined ? null : copy(options)]);
    if (entity === "agents") {
      await gate("agents.list");
      return copy(world().agents);
    }
    const kind = ENTITY_KIND[entity];
    if (!kind) return [];
    await gate(`${kind}.list`);
    return copy(world()[kind].filter((row) => row.presetId === options?.filters?.presetId));
  },
  async create(entity: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.create", entity, copy(payload)]);
    const kind = ENTITY_KIND[entity]!;
    await gate(`${kind}.create`);
    state.created[kind] += 1;
    const row: Row = {
      ...copy(payload),
      id: `${CREATED_PREFIX[kind]}-${state.created[kind]}`,
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    world()[kind].push(row);
    if (state.noIdNext.delete(kind)) {
      const { id: _id, ...withoutId } = row;
      return copy(withoutId);
    }
    return copy(row);
  },
  async update(entity: string, id: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.update", entity, id, copy(payload)]);
    if (entity === "prompts") {
      await gate("prompts.update");
      const presets = world().presets;
      const index = presets.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`Not found: ${id}`);
      presets[index] = { ...presets[index]!, ...copy(payload), updatedAt: STAMP };
      return copy(presets[index]!);
    }
    const kind = ENTITY_KIND[entity]!;
    await gate(`${kind}.update`);
    const rows = world()[kind];
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`Not found: ${id}`);
    rows[index] = { ...rows[index]!, ...copy(payload), updatedAt: STAMP };
    return copy(rows[index]!);
  },
  async delete(entity: string, id: string) {
    state.calls.push(["storage.delete", entity, id]);
    const kind = ENTITY_KIND[entity]!;
    await gate(`${kind}.delete`);
    world()[kind] = world()[kind].filter((row) => row.id !== id);
    return null;
  },
};

/** Stands in for `promptNestedApi`. */
export const fakePromptNestedApi = {
  async reorder(input: { presetId: string; kind: Kind; ids: string[] }) {
    state.calls.push(["reorder", copy(input)]);
    await gate("reorder");
    const data = world();
    const place = (row: Row) => {
      const at = input.ids.indexOf(row.id);
      return at < 0 ? Number.POSITIVE_INFINITY : at;
    };
    const rows = data[input.kind];
    const mine = rows.filter((row) => row.presetId === input.presetId).sort((a, b) => place(a) - place(b));
    data[input.kind] = [...rows.filter((row) => row.presetId !== input.presetId), ...mine];
    const preset = presetRow(input.presetId);
    if (preset) preset[ORDER_KEY[input.kind]] = [...input.ids];
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

/** Stands in for the global `localStorage` (reads aren't recorded; writes are, before they may throw). */
export const fakeLocalStorage = {
  getItem(key: string) {
    if (world().storage.throwGet) throw new Error("SecurityError: storage is blocked");
    return state.storage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    state.calls.push(["localStorage.setItem", key, value]);
    if (world().storage.throwSet) throw new Error("QuotaExceededError: storage is full");
    state.storage.set(key, String(value));
  },
  removeItem(key: string) {
    state.calls.push(["localStorage.removeItem", key]);
    if (world().storage.throwSet) throw new Error("QuotaExceededError: storage is full");
    state.storage.delete(key);
  },
  clear() {
    state.storage.clear();
  },
  key(index: number) {
    return [...state.storage.keys()][index] ?? null;
  },
  get length() {
    return state.storage.size;
  },
};
