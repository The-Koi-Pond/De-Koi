import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { characterKeys } from "../query-keys";
import { cacheCharacterListRecordFromResult } from "./character-query-cache";

describe("character query cache", () => {
  it("refreshes panel summaries from a saved character result", () => {
    const store = new Map<string, unknown>();
    const keyFor = (key: readonly unknown[]) => JSON.stringify(key);
    const panelSummariesKey = characterKeys.panelSummaries();
    const savedCharacter = {
      id: "char-1",
      data: { name: "Harlequin", scenario: "After save" },
      comment: "The Seductive Rival",
      avatarPath: null,
    };

    store.set(keyFor(panelSummariesKey), [
      {
        id: "char-1",
        data: { name: "Harlequin", scenario: "Before save" },
        comment: "Old title",
        avatarPath: null,
      },
    ]);

    const queryClient = {
      getQueryData: vi.fn((key: readonly unknown[]) => store.get(keyFor(key))),
      setQueryData: vi.fn((key: readonly unknown[], updater: unknown) => {
        const next = typeof updater === "function" ? updater(store.get(keyFor(key))) : updater;
        store.set(keyFor(key), next);
      }),
    };

    expect(
      cacheCharacterListRecordFromResult(queryClient as unknown as Pick<QueryClient, "getQueryData" | "setQueryData">, {
        character: savedCharacter,
      }),
    ).toBe(true);
    expect(store.get(keyFor(panelSummariesKey))).toEqual([savedCharacter]);
  });
});