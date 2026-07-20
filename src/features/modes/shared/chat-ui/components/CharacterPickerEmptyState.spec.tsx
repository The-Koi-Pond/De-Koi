import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterPickerEmptyState } from "./CharacterPickerEmptyState";

describe("CharacterPickerEmptyState", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("offers Open Characters only when the character library is truly empty", () => {
    const onOpenCharacters = vi.fn();
    act(() =>
      root.render(
        <CharacterPickerEmptyState
          hasError={false}
          isPending={false}
          hasSearch={false}
          hasCharacters={false}
          hasUnselectedCharacters={false}
          noCharactersText="No characters yet."
          allAddedText="All characters added."
          onOpenCharacters={onOpenCharacters}
        />,
      ),
    );

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Open Characters");
    act(() => button?.click());
    expect(onOpenCharacters).toHaveBeenCalledOnce();
  });

  it.each([
    ["loading", { isPending: true }],
    ["error", { hasError: true }],
    ["search miss", { hasSearch: true, hasCharacters: true, hasUnselectedCharacters: true }],
    ["all selected", { hasCharacters: true, hasUnselectedCharacters: false }],
  ])("does not offer recovery for %s", (_name, overrides) => {
    act(() =>
      root.render(
        <CharacterPickerEmptyState
          hasError={false}
          isPending={false}
          hasSearch={false}
          hasCharacters={false}
          hasUnselectedCharacters={false}
          noCharactersText="No characters yet."
          allAddedText="All characters added."
          onOpenCharacters={() => undefined}
          {...overrides}
        />,
      ),
    );

    expect(container.querySelector("button")).toBeNull();
  });
});
