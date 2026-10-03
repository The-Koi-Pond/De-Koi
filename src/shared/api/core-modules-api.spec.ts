import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUSIC_DJ_MINI_PLAYER_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { coreModulesApi, settingsFromLegacyUiStorageValue } from "./core-modules-api";

// An app-settings table with the runtime's compare-and-set semantics. Reads can
// be held so two clients both read before either writes.
const { store } = vi.hoisted(() => {
  const rows = new Map<string, { id: string; value: unknown }>();
  let heldReads: Array<() => void> | null = null;
  const snapshot = (id: string) => {
    const row = rows.get(id);
    return row ? structuredClone(row) : null;
  };
  return {
    store: {
      rows,
      holdReads() {
        heldReads = [];
      },
      releaseReads() {
        const pending = heldReads ?? [];
        heldReads = null;
        for (const release of pending) release();
      },
      heldReadCount: () => heldReads?.length ?? 0,
      api: {
        get: async (_entity: string, id: string) => {
          const row = snapshot(id);
          if (!heldReads) return row;
          return new Promise((resolve) => heldReads!.push(() => resolve(row)));
        },
        create: async (_entity: string, row: { id: string; value: unknown }) => {
          rows.set(row.id, structuredClone(row));
          return row;
        },
        update: async (_entity: string, id: string, patch: { value: unknown }) => {
          rows.set(id, { id, value: structuredClone(patch.value) });
          return rows.get(id);
        },
        updateAppSettingsIfUnchanged: async (id: string, expectedValue: unknown, value: unknown) => {
          const current = rows.get(id);
          if (!current || JSON.stringify(current.value) !== JSON.stringify(expectedValue)) return { updated: false };
          rows.set(id, { id, value: structuredClone(value) });
          return { updated: true };
        },
      },
    },
  };
});

vi.mock("./storage-api", () => ({ storageApi: store.api }));

describe("coreModulesApi legacy settings migration", () => {
  it("enables the Music Player mini player when the legacy Spotify UI setting was enabled", () => {
    const migrated = settingsFromLegacyUiStorageValue(
      JSON.stringify({
        state: {
          spotifyPlayerEnabled: true,
        },
        version: 10,
      }),
    );

    expect(migrated).toEqual({
      enabled: {
        [MUSIC_DJ_MINI_PLAYER_MODULE_ID]: true,
      },
    });
  });

  it("ignores missing, disabled, or malformed legacy UI settings", () => {
    expect(settingsFromLegacyUiStorageValue(null)).toEqual({ enabled: {} });
    expect(settingsFromLegacyUiStorageValue("{")).toEqual({ enabled: {} });
    expect(settingsFromLegacyUiStorageValue(JSON.stringify({ state: { spotifyPlayerEnabled: false } }))).toEqual({
      enabled: {},
    });
  });
});

describe("coreModulesApi settings writes", () => {
  beforeEach(() => {
    store.rows.clear();
    store.rows.set("core-modules", { id: "core-modules", value: { enabled: {} } });
  });

  it("only changes settings through operations that are re-applied after a conflict", () => {
    // A whole-object save would retry with a stale snapshot and undo a
    // concurrent toggle, so there is none.
    expect(Object.keys(coreModulesApi.settings).sort()).toEqual(["get", "setEnabled"]);
  });

  it("keeps both toggles when two clients change different modules at the same time", async () => {
    store.holdReads();
    const first = coreModulesApi.settings.setEnabled("module-a", true);
    const second = coreModulesApi.settings.setEnabled("module-b", true);
    await vi.waitFor(() => expect(store.heldReadCount()).toBe(2));
    store.releaseReads();
    await Promise.all([first, second]);

    expect(store.rows.get("core-modules")?.value).toEqual({ enabled: { "module-a": true, "module-b": true } });
  });
});
