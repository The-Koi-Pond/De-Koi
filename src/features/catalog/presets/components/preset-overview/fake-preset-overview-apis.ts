// The recorder's fakes at the API boundary (test-fixtures/README.md, "The harness"), for the replay tests. It imports
// only React (for the Sections tab probe) so `vi.mock` factories can load it.
import { createElement } from "react";

type Row = Record<string, unknown> & { id: string };

type Kind = "sections" | "groups" | "variables";

export type Op =
  | "prompts.get"
  | "prompts.update"
  | "prompts.delete"
  | "chats.get"
  | `${Kind}.list`
  | `${Kind}.update`
  | "export"
  | "connections.list";

/** One scenario's stored data (README, "Building the stored data from a world"). */
export interface World {
  presets: Row[];
  sections: Row[];
  groups: Row[];
  variables: Row[];
  chats: Row[];
  connections: Row[];
}

const STAMP = "2026-01-02T00:00:00.000Z";

const ENTITY_KIND: Record<string, Kind> = {
  "prompt-sections": "sections",
  "prompt-groups": "groups",
  "prompt-variables": "variables",
};

const copy = <T>(value: T): T => structuredClone(value);

const state = {
  world: null as World | null,
  calls: [] as unknown[][],
  failures: new Map<Op, string>(),
  held: new Set<Op>(),
  waiting: new Map<Op, Array<() => void>>(),
  confirmAnswer: true,
  exportReport: undefined as unknown,
  probeProps: null as Record<string, unknown> | null,
};

function world(): World {
  if (!state.world) throw new Error("fakePresetOverviewApis.reset() was not called");
  return state.world;
}

export const fakePresetOverviewApis = {
  reset(next: World) {
    state.world = copy(next);
    state.calls = [];
    state.failures.clear();
    state.held.clear();
    state.waiting.clear();
    state.confirmAnswer = true;
    state.exportReport = undefined;
    state.probeProps = null;
  },
  /** Every fake call so far, in order, as the recorder noted them. */
  get calls(): readonly unknown[][] {
    return state.calls;
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
  setExportReport(report: unknown) {
    state.exportReport = report;
  },
  /** Merges `patch` into a stored preset row (no call is logged). */
  patchPreset(id: string, patch: Record<string, unknown>) {
    const presets = world().presets;
    const index = presets.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No preset row ${id}`);
    presets[index] = { ...presets[index]!, ...copy(patch) };
  },
  /** Removes a stored preset row (no call is logged). */
  deletePreset(id: string) {
    world().presets = world().presets.filter((row) => row.id !== id);
  },
  /** The props the Sections tab probe last rendered with. */
  get probeProps(): Record<string, unknown> | null {
    return state.probeProps;
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

function rowsOf(entity: string): Row[] | null {
  if (entity === "prompts") return world().presets;
  if (entity === "chats") return world().chats;
  const kind = ENTITY_KIND[entity];
  return kind ? world()[kind] : null;
}

/** Stands in for `storageApi` (only what the preset and chat hooks call). */
export const fakeStorageApi = {
  async get(entity: string, id: string, options?: unknown) {
    state.calls.push(["storage.get", entity, id, options === undefined ? null : copy(options)]);
    if (entity === "prompts") await gate("prompts.get");
    else if (entity === "chats") await gate("chats.get");
    const row = rowsOf(entity)?.find((candidate) => candidate.id === id);
    return row ? copy(row) : null;
  },
  async list(entity: string, options?: { filters?: { presetId?: string } }) {
    state.calls.push(["storage.list", entity, options === undefined ? null : copy(options)]);
    const kind = ENTITY_KIND[entity];
    if (!kind) return [];
    await gate(`${kind}.list`);
    return copy(world()[kind].filter((row) => row.presetId === options?.filters?.presetId));
  },
  async update(entity: string, id: string, payload: Record<string, unknown>) {
    state.calls.push(["storage.update", entity, id, copy(payload)]);
    const kind = ENTITY_KIND[entity];
    await gate(entity === "prompts" ? "prompts.update" : `${kind!}.update`);
    const rows = rowsOf(entity)!;
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`Not found: ${id}`);
    rows[index] = { ...rows[index]!, ...copy(payload), updatedAt: STAMP };
    return copy(rows[index]!);
  },
  async delete(entity: string, id: string) {
    state.calls.push(["storage.delete", entity, id]);
    if (entity === "prompts") {
      await gate("prompts.delete");
      world().presets = world().presets.filter((row) => row.id !== id);
    }
    return null;
  },
};

/** Stands in for `exportApi.prompt`. */
export async function fakeExportPrompt(presetId: string) {
  state.calls.push(["export.prompt", presetId]);
  await gate("export");
  return {
    blob: new Blob(["{}"], { type: "application/json" }),
    filename: "preset.dekoi.json",
    ...(state.exportReport === undefined ? {} : { report: copy(state.exportReport) }),
  };
}

/** Stands in for `triggerDownload`. */
export function fakeTriggerDownload(payload: { filename: string }) {
  state.calls.push(["triggerDownload", payload.filename]);
}

/** Stands in for `connectionsUtilityApi.list`. */
export async function fakeConnectionsList() {
  state.calls.push(["connections.list"]);
  await gate("connections.list");
  return copy(world().connections);
}

/** Stands in for `reviewPromptPreset`; the recordings never start a review. */
// eslint-disable-next-line require-yield -- it only logs and refuses
export async function* fakeReviewPromptPreset(...args: unknown[]): AsyncGenerator<never> {
  state.calls.push(["reviewPromptPreset", copy(args)]);
  throw new Error("reviewPromptPreset is not part of the recordings");
}

/** Stands in for `showConfirmDialog`: records the options and gives the answer set by `answerConfirm`. */
export async function fakeConfirmDialog(options: unknown): Promise<boolean> {
  state.calls.push(["confirm", copy(options)]);
  return state.confirmAnswer;
}

function recordToast(kind: string) {
  return (message: unknown, options?: unknown) => {
    state.calls.push(options === undefined ? ["toast", kind, message] : ["toast", kind, message, copy(options)]);
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

const idsOf = (rows: unknown) => (Array.isArray(rows) ? rows.map((row: { id?: unknown }) => row.id) : rows);

/**
 * Stands in for the Sections tab: keeps its props for `sectionsMutate` steps and shows the summary the recorder
 * noted (README, "The harness").
 */
export function ProbeSectionsTab(props: Record<string, unknown>) {
  state.probeProps = props;
  const groupMap = props.groupMap as Map<string, { name?: unknown }>;
  const summary = {
    presetId: props.presetId,
    sections: idsOf(props.sections),
    groups: [...groupMap.entries()].map(([id, group]) => [id, group.name]),
    choiceBlocks: idsOf(props.choiceBlocks),
    wrapFormat: props.wrapFormat,
    hasLorebookMarker: props.hasLorebookMarker,
    parentChatHasLorebook: props.parentChatHasLorebook,
    props: Object.keys(props).sort(),
  };
  return createElement("div", { "data-probe": "sections" }, JSON.stringify(summary));
}
