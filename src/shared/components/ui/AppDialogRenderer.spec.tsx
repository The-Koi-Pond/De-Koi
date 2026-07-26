import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { showConfirmDialogWithOption } from "../../lib/app-dialogs";
import { AppDialogRenderer } from "./AppDialogRenderer";

describe("AppDialogRenderer option confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<AppDialogRenderer />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("starts unchecked and resolves the selected option on confirmation", async () => {
    let result!: Promise<{ confirmed: boolean; optionChecked: boolean }>;
    await act(async () => {
      result = showConfirmDialogWithOption({
        title: "Delete chat?",
        message: "The chat history will be deleted.",
        optionLabel: "Also delete memories learned only from this chat",
        defaultChecked: false,
        confirmLabel: "Delete chat",
      });
    });

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);
    act(() => checkbox?.click());
    expect(checkbox?.checked).toBe(true);

    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete chat",
    );
    act(() => confirm?.click());
    await expect(result).resolves.toEqual({ confirmed: true, optionChecked: true });
  });
});
