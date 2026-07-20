import { notifyDraftPersistenceFailure } from "../../../../shared/lib/draft-persistence-events";

export interface GameInputAttachment {
  type: string;
  data: string;
  name: string;
}

export type GameInputAddressMode = "scene" | "party" | "gm";

export interface GameInputDraftSnapshot {
  text: string;
  queuedDice: string | null;
  addressMode: GameInputAddressMode;
  attachments: GameInputAttachment[];
}

export interface GameInputDraftSubmission extends GameInputDraftSnapshot {
  readonly draftKey: string | null | undefined;
  readonly textRevision: number;
  readonly queuedDiceRevision: number;
}

export interface GameInputDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface GameInputDraftState extends GameInputDraftSnapshot {
  pendingAttachmentReads: number;
  textRevision: number;
  queuedDiceRevision: number;
}

interface PersistedGameInputScalars {
  queuedDice: string | null;
  addressMode: GameInputAddressMode;
}

interface DraftStoreOptions {
  storage?: GameInputDraftStorage;
  onPersistenceError?: (operation: "load" | "save" | "clear", error: unknown) => void;
}

const UNKEYED_DRAFT = "__game-input-unkeyed__";

function normalizeDraftKey(draftKey: string | null | undefined): string {
  return draftKey || UNKEYED_DRAFT;
}

function textStorageKey(draftKey: string): string {
  return `game-input-draft:${draftKey}`;
}

function scalarStorageKey(draftKey: string): string {
  return `game-input-draft-state:${draftKey}`;
}

function isAddressMode(value: unknown): value is GameInputAddressMode {
  return value === "scene" || value === "party" || value === "gm";
}

function defaultBrowserStorage(): GameInputDraftStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createGameInputDraftStore(options: DraftStoreOptions = {}) {
  const states = new Map<string, GameInputDraftState>();
  const storage = options.storage ?? defaultBrowserStorage();
  const reportPersistenceError =
    options.onPersistenceError ??
    ((operation: "load" | "save" | "clear", error: unknown) => {
      notifyDraftPersistenceFailure("game input draft", operation, error);
    });

  const canPersist = (draftKey: string | null | undefined): draftKey is string => Boolean(draftKey);

  const readPersistedState = (draftKey: string | null | undefined): GameInputDraftState => {
    const fallback: GameInputDraftState = {
      text: "",
      queuedDice: null,
      addressMode: "scene",
      attachments: [],
      pendingAttachmentReads: 0,
      textRevision: 0,
      queuedDiceRevision: 0,
    };
    if (!storage || !canPersist(draftKey)) return fallback;

    try {
      fallback.text = storage.getItem(textStorageKey(draftKey)) ?? "";
      const rawScalars = storage.getItem(scalarStorageKey(draftKey));
      if (!rawScalars) return fallback;
      const scalars = JSON.parse(rawScalars) as Partial<PersistedGameInputScalars>;
      fallback.queuedDice = typeof scalars.queuedDice === "string" ? scalars.queuedDice : null;
      fallback.addressMode = isAddressMode(scalars.addressMode) ? scalars.addressMode : "scene";
    } catch (error) {
      reportPersistenceError("load", error);
    }
    return fallback;
  };

  const getState = (draftKey: string | null | undefined): GameInputDraftState => {
    const normalizedKey = normalizeDraftKey(draftKey);
    const existing = states.get(normalizedKey);
    if (existing) return existing;
    const initial = readPersistedState(draftKey);
    states.set(normalizedKey, initial);
    return initial;
  };

  const persistText = (draftKey: string | null | undefined, text: string): void => {
    if (!storage || !canPersist(draftKey)) return;
    try {
      if (text) storage.setItem(textStorageKey(draftKey), text);
      else storage.removeItem(textStorageKey(draftKey));
    } catch (error) {
      reportPersistenceError(text ? "save" : "clear", error);
    }
  };

  const persistScalars = (draftKey: string | null | undefined, state: GameInputDraftState): void => {
    if (!storage || !canPersist(draftKey)) return;
    try {
      if (state.queuedDice === null && state.addressMode === "scene") {
        storage.removeItem(scalarStorageKey(draftKey));
        return;
      }
      const scalars: PersistedGameInputScalars = {
        queuedDice: state.queuedDice,
        addressMode: state.addressMode,
      };
      storage.setItem(scalarStorageKey(draftKey), JSON.stringify(scalars));
    } catch (error) {
      reportPersistenceError(state.queuedDice === null && state.addressMode === "scene" ? "clear" : "save", error);
    }
  };

  const read = (draftKey: string | null | undefined): GameInputDraftSnapshot => {
    const state = getState(draftKey);
    return {
      text: state.text,
      queuedDice: state.queuedDice,
      addressMode: state.addressMode,
      attachments: [...state.attachments],
    };
  };

  const setText = (draftKey: string | null | undefined, text: string): void => {
    const state = getState(draftKey);
    state.textRevision += 1;
    state.text = text;
    persistText(draftKey, text);
  };

  const setQueuedDice = (draftKey: string | null | undefined, queuedDice: string | null): void => {
    const state = getState(draftKey);
    state.queuedDiceRevision += 1;
    state.queuedDice = queuedDice;
    persistScalars(draftKey, state);
  };

  const setAddressMode = (draftKey: string | null | undefined, addressMode: GameInputAddressMode): void => {
    const state = getState(draftKey);
    state.addressMode = addressMode;
    persistScalars(draftKey, state);
  };

  const addAttachment = (draftKey: string | null | undefined, attachment: GameInputAttachment): void => {
    getState(draftKey).attachments.push(attachment);
  };

  const removeAttachment = (draftKey: string | null | undefined, index: number): void => {
    getState(draftKey).attachments.splice(index, 1);
  };

  const beginAttachmentRead = (draftKey: string | null | undefined) => {
    const state = getState(draftKey);
    state.pendingAttachmentReads += 1;
    let settled = false;

    const settle = (nextAttachment?: GameInputAttachment): void => {
      if (settled) return;
      settled = true;
      state.pendingAttachmentReads = Math.max(0, state.pendingAttachmentReads - 1);
      if (nextAttachment) state.attachments.push(nextAttachment);
    };

    return {
      complete: (nextAttachment: GameInputAttachment) => settle(nextAttachment),
      cancel: () => settle(),
    };
  };

  const captureSubmission = (draftKey: string | null | undefined): GameInputDraftSubmission => {
    const state = getState(draftKey);
    return {
      draftKey,
      text: state.text,
      queuedDice: state.queuedDice,
      addressMode: state.addressMode,
      attachments: [...state.attachments],
      textRevision: state.textRevision,
      queuedDiceRevision: state.queuedDiceRevision,
    };
  };

  const completeSubmission = (submission: GameInputDraftSubmission, sent: boolean): void => {
    if (!sent) return;
    const state = getState(submission.draftKey);

    if (state.textRevision === submission.textRevision) {
      state.textRevision += 1;
      state.text = "";
      persistText(submission.draftKey, "");
    }
    if (state.queuedDiceRevision === submission.queuedDiceRevision) {
      state.queuedDiceRevision += 1;
      state.queuedDice = null;
      persistScalars(submission.draftKey, state);
    }

    const submittedAttachments = new Set(submission.attachments);
    state.attachments = state.attachments.filter((item) => !submittedAttachments.has(item));
  };

  const completeTextSubmission = (submission: GameInputDraftSubmission, sent: boolean): void => {
    if (!sent) return;
    const state = getState(submission.draftKey);
    if (state.textRevision !== submission.textRevision) return;
    state.textRevision += 1;
    state.text = "";
    persistText(submission.draftKey, "");
  };

  const hasUnsavedMemoryWork = (): boolean =>
    [...states.values()].some((state) => state.attachments.length > 0 || state.pendingAttachmentReads > 0);

  return {
    read,
    setText,
    setQueuedDice,
    setAddressMode,
    addAttachment,
    removeAttachment,
    beginAttachmentRead,
    captureSubmission,
    completeSubmission,
    completeTextSubmission,
    hasUnsavedMemoryWork,
  };
}

export const gameInputDrafts = createGameInputDraftStore();
