export type OverlayEscapeHandler = () => boolean | void;

export type OverlayStackEntry = {
  id: string;
  active?: boolean;
  onEscape: OverlayEscapeHandler;
};

export type OverlayStack = {
  register: (entry: OverlayStackEntry) => () => void;
  update: (id: string, entry: OverlayStackEntry) => void;
  handleEscape: () => boolean;
  clear: () => void;
  size: () => number;
};

export function createOverlayStack(): OverlayStack {
  const entries: OverlayStackEntry[] = [];

  function findIndex(id: string) {
    return entries.findIndex((entry) => entry.id === id);
  }

  return {
    register(entry) {
      const existingIndex = findIndex(entry.id);
      if (existingIndex >= 0) entries.splice(existingIndex, 1);
      entries.push(entry);
      return () => {
        const index = findIndex(entry.id);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    update(id, entry) {
      const index = findIndex(id);
      if (index >= 0) {
        entries[index] = entry;
        return;
      }
      entries.push(entry);
    },
    handleEscape() {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (!entry || entry.active === false) continue;
        const handled = entry.onEscape();
        return handled !== false;
      }
      return false;
    },
    clear() {
      entries.splice(0, entries.length);
    },
    size() {
      return entries.length;
    },
  };
}

export const overlayStack = createOverlayStack();
