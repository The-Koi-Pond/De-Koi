import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TagInput } from "./TagInput";

describe("TagInput", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("offers unused matching tag suggestions and applies the selected suggestion", () => {
    const onTagsChange = vi.fn();
    const onInputChange = vi.fn();

    function Harness() {
      const [tags, setTags] = useState(["dbd"]);
      const [inputValue, setInputValue] = useState("");
      return (
        <TagInput
          label="Tags"
          tags={tags}
          inputValue={inputValue}
          onInputChange={(value) => {
            onInputChange(value);
            setInputValue(value);
          }}
          onTagsChange={(nextTags) => {
            onTagsChange(nextTags);
            setTags(nextTags);
          }}
          suggestions={["dbd", "slasher", "Scenario"]}
        />
      );
    }

    act(() => {
      root = createRoot(container!);
      root.render(<Harness />);
    });

    const input = container!.querySelector<HTMLInputElement>("input[placeholder='Add tag...']");
    expect(input).not.toBeNull();

    act(() => {
      input!.focus();
      input!.value = "sl";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const suggestion = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "slasher",
    );
    expect(suggestion).toBeTruthy();

    act(() => {
      suggestion!.click();
    });

    expect(onTagsChange).toHaveBeenCalledWith(["dbd", "slasher"]);
    expect(onInputChange).toHaveBeenLastCalledWith("");
  });
});
