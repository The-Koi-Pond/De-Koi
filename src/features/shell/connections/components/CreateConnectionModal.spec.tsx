import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => ({ id: "conn-1" })) }));

vi.mock("../../../catalog/connections", () => ({
  useCreateConnection: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

import { CreateConnectionModal } from "./CreateConnectionModal";

// First-timers saw 13 providers with no hint which one fits, and had to invent a required name.
describe("CreateConnectionModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutateAsync.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const button = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label)!;

  it("explains the picked provider in one line", () => {
    act(() => root.render(<CreateConnectionModal open onClose={() => {}} />));
    act(() => button("Claude (Subscription)").click());
    expect(document.body.textContent).toContain("Uses your Claude plan instead of an API key.");
    expect(document.body.textContent).toContain("You pick a model on the next screen.");
    expect(document.body.textContent).not.toContain("You add the key");
    act(() => button("OpenRouter").click());
    expect(document.body.textContent).toContain("One API key for models from many companies.");
    expect(document.body.textContent).toContain("You add the key and pick a model on the next screen.");
  });

  it("creates with the provider's name when the name is left empty", async () => {
    act(() => root.render(<CreateConnectionModal open onClose={() => {}} />));
    act(() => button("OpenRouter").click());
    expect(button("Create").disabled).toBe(false);
    await act(async () => button("Create").click());
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: "OpenRouter", provider: "openrouter" }),
    );
  });
});
