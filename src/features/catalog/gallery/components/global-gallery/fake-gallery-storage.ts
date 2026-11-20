// The recorder's stand-ins (test-fixtures/README.md), rebuilt for the panel tests: in-memory storage behind
// the real gallery hooks, the upload call, the dialogs, toasts, file URL resolvers, the tag control and the
// virtualizer. Spec files install them with `vi.mock`; this file imports nothing from the app so the mock
// factories can load it.
import { createElement } from "react";

type Row = Record<string, unknown> & { id: string };
type Folder = Row & { name: string; createdAt: string };

export type HoldOp = "upload" | "update" | "create" | "delete" | "list:global-gallery" | "list:gallery-folders";
export type FailOp = "create" | "update" | "delete" | "list:global-gallery" | "list:gallery-folders";

const copy = <T>(value: T): T => structuredClone(value);

const state = {
  images: [] as Row[],
  folders: [] as Folder[],
  calls: [] as unknown[][],
  failures: new Map<FailOp, string>(),
  failFiles: new Map<string, string>(),
  held: new Set<HoldOp>(),
  waiting: new Map<HoldOp, Array<() => void>>(),
  answers: [] as unknown[],
  created: 0,
  visibleRows: Number.POSITIVE_INFINITY,
  virtualizerOptions: null as Record<string, unknown> | null,
};

function record(...call: unknown[]) {
  // Stored as JSON, as the recorder saved them (an `undefined` argument reads back as null).
  state.calls.push(JSON.parse(JSON.stringify(call)) as unknown[]);
}

/** Takes this op's queued failure now, waits while the op is held, then throws the failure if there was one. */
async function gate(failOp: FailOp | null, holdOp: HoldOp) {
  const failure = failOp ? state.failures.get(failOp) : undefined;
  if (failOp) state.failures.delete(failOp);
  if (state.held.has(holdOp)) {
    await new Promise<void>((resolve) => {
      state.waiting.set(holdOp, [...(state.waiting.get(holdOp) ?? []), resolve]);
    });
  }
  if (failure !== undefined) throw new Error(failure);
}

function next() {
  state.created += 1;
  return state.created;
}

function plainCompare(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Newest first by `createdAt` string, then id, both descending. */
function compareNewest(a: Row, b: Row) {
  return plainCompare(String(b.createdAt), String(a.createdAt)) || plainCompare(String(b.id), String(a.id));
}

function rowsOf(entity: string): Row[] {
  if (entity === "global-gallery") return state.images;
  if (entity === "gallery-folders") return state.folders;
  throw new Error(`Unexpected entity ${entity}`);
}

export const fakeGallery = {
  reset(images: readonly Row[], folders: readonly Folder[]) {
    state.images = copy([...images]);
    state.folders = copy([...folders]);
    state.calls = [];
    state.failures.clear();
    state.failFiles.clear();
    state.held.clear();
    state.waiting.clear();
    state.answers = [];
    state.created = 0;
    state.visibleRows = Number.POSITIVE_INFINITY;
    state.virtualizerOptions = null;
  },
  /** Every storage call, upload, dialog and toast so far, in order. */
  get calls(): readonly unknown[][] {
    return state.calls;
  },
  get images(): readonly Row[] {
    return state.images;
  },
  get folders(): readonly Folder[] {
    return state.folders;
  },
  /** The next dialog's answer (unanswered: confirm `true`, prompt `null`). */
  answer(value: unknown) {
    state.answers.push(value);
  },
  /** The next `op` throws `new Error(message)`. */
  fail(op: FailOp, message: string) {
    state.failures.set(op, message);
  },
  failFile(name: string, reason: string) {
    state.failFiles.set(name, reason);
  },
  /** `op` waits until `release(op)`. */
  hold(op: HoldOp) {
    state.held.add(op);
  },
  release(op: HoldOp) {
    state.held.delete(op);
    const waiting = state.waiting.get(op) ?? [];
    state.waiting.delete(op);
    for (const resolve of waiting) resolve();
  },
  /** Removes a folder behind the panel's back, as another tab would. */
  removeFolder(folderId: string) {
    state.folders = state.folders.filter((folder) => folder.id !== folderId);
  },
  /** How many grid rows the virtualizer stand-in reports (default: all of them). */
  showRows(count: number) {
    state.visibleRows = count;
  },
  /** The options the panel last gave the virtualizer stand-in. */
  get virtualizerOptions() {
    return state.virtualizerOptions;
  },
};

export const fakeStorageApi = {
  async list(entity: string, options?: { limit?: number; before?: string }) {
    record("list", entity, options);
    await gate(`list:${entity}` as FailOp, `list:${entity}` as HoldOp);
    if (entity === "gallery-folders") return copy(state.folders);
    let rows = [...rowsOf(entity)].sort(compareNewest);
    if (options?.before) {
      const cut = options.before.lastIndexOf("|");
      const cursor = { createdAt: options.before.slice(0, cut), id: options.before.slice(cut + 1) } as Row;
      rows = rows.filter((row) => compareNewest(cursor, row) < 0);
    }
    return copy(options?.limit === undefined ? rows : rows.slice(0, options.limit));
  },
  async create(entity: string, data: Record<string, unknown>) {
    record("create", entity, data);
    await gate("create", "create");
    const n = next();
    const row = { ...copy(data), id: `new-folder-${n}`, createdAt: `2026-02-0${n}T12:00:00.000Z` } as Folder;
    rowsOf(entity).push(row);
    return copy(row);
  },
  async update(entity: string, id: string, patch: Record<string, unknown>) {
    record("update", entity, id, patch);
    await gate("update", "update");
    const rows = rowsOf(entity);
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`No ${entity} row ${id}`);
    rows[index] = { ...rows[index]!, ...copy(patch) };
    return copy(rows[index]);
  },
  async delete(entity: string, id: string) {
    record("delete", entity, id);
    await gate("delete", "delete");
    if (entity === "global-gallery") {
      state.images = state.images.filter((image) => image.id !== id);
    } else {
      state.folders = state.folders.filter((folder) => folder.id !== id);
      state.images = state.images.map((image) => (image.folderId === id ? { ...image, folderId: null } : image));
    }
    return { ok: true };
  },
};

export const fakeGalleryApi = {
  async uploadGlobal(file: File, folderId?: string | null) {
    record("upload", file.name, folderId);
    await gate(null, "upload");
    const reason = state.failFiles.get(file.name);
    if (reason !== undefined) throw new Error(reason);
    const n = next();
    const row = {
      id: `up-${n}`,
      folderId,
      filePath: `/data/gallery/${file.name}`,
      filename: file.name,
      prompt: "",
      provider: "upload",
      model: "",
      width: 64,
      height: 64,
      createdAt: `2026-03-0${n}T12:00:00.000Z`,
      url: `/api/gallery/file/${file.name}`,
    };
    state.images.push(row);
    return copy(row);
  },
};

function answerDialog(kind: "confirm" | "prompt", options: unknown) {
  record(kind, options);
  const answer = state.answers.length > 0 ? state.answers.shift() : kind === "confirm" ? true : null;
  return Promise.resolve(answer);
}

export const fakeConfirmDialog = (options: unknown) => answerDialog("confirm", options) as Promise<boolean>;
export const fakePromptDialog = (options: unknown) => answerDialog("prompt", options) as Promise<string | null>;

const toastKind = (kind: string) => (message: unknown) => {
  record("toast", kind, message);
  return kind;
};

export const fakeToast = Object.assign(toastKind("default"), {
  error: toastKind("error"),
  warning: toastKind("warning"),
  success: toastKind("success"),
  info: toastKind("info"),
  message: toastKind("message"),
});

export const fakeFileUrls = {
  galleryThumbnailPath: (filename: string | null | undefined, filePath?: string | null) =>
    `${filename ?? "-"}~${filePath ?? "-"}`,
  resolveManagedAssetThumbnailFileUrl: async (kind: string, path: string | null | undefined, size = 256) => {
    if (path?.includes("raw.png")) throw new Error("thumbnail failed");
    if (path?.includes("img-2")) return null;
    return `thumb:${kind}:${size}:${path}`;
  },
  resolveGalleryFileUrl: async (filename: string | null | undefined, filePath?: string | null) =>
    filename ? `full:${filename}~${filePath ?? "-"}` : null,
};

interface TaggableImage {
  id: string;
  customKind?: string | null;
}

export function FakeTagButton({
  image,
  onApply,
}: {
  image: TaggableImage;
  onApply: (patch: Record<string, unknown>) => void;
}) {
  return createElement("button", {
    type: "button",
    "aria-label": `Tag ${image.id}`,
    "data-kind": image.customKind ?? "",
    onClick: () => onApply({ customKind: "sticker", customName: `n_${image.id}`, width: 64, height: 64 }),
  });
}

/** Shows every row (or the first `showRows(n)`), each `estimateSize()` tall; measuring does nothing. */
export function fakeUseVirtualizer(options: { count: number; estimateSize: (index: number) => number }) {
  const { count, estimateSize } = options;
  state.virtualizerOptions = options;
  const shown = Math.min(count, state.visibleRows);
  return {
    getVirtualItems: () =>
      Array.from({ length: shown }, (_, index) => ({ key: index, index, start: index * estimateSize(index) })),
    getTotalSize: () => count * estimateSize(0),
    measureElement: () => undefined,
  };
}
