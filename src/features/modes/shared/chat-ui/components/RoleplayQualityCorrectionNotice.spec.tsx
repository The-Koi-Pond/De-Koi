import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleplayQualityCorrectionExtra } from "../../../../../engine/contracts/types/chat";
import { RoleplayQualityCorrectionNotice } from "./RoleplayQualityCorrectionNotice";

const original = 'Kaul taps the glass. "Stuck again." You know a barometer can stick. The needle sits on 29.4.';
const corrected = 'Kaul taps the glass. "Stuck again." The needle sits on 29.4.';
const correction: RoleplayQualityCorrectionExtra = {
  source: "focused_editor_audit",
  reasons: ["agency"],
  evidence: ["You know a barometer can stick. "],
  durationMs: 4200,
  originalContent: original,
  correctedContent: corrected,
  edits: [{ before: "You know a barometer can stick. ", after: "", reason: "agency" }],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(content: string, onEdit?: (messageId: string, content: string) => void) {
  act(() => {
    root.render(
      <RoleplayQualityCorrectionNotice
        correction={correction}
        content={content}
        messageId="message-1"
        onEdit={onEdit}
      />,
    );
  });
}

describe("RoleplayQualityCorrectionNotice", () => {
  it("names the fix, shows the exact change on request, and restores the original", async () => {
    const onEdit = vi.fn();
    render(corrected, onEdit);

    expect(container.textContent).toContain("Auto-fixed: kept your character's choices yours");
    expect(container.textContent).not.toContain("You know a barometer can stick.");
    act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    expect(container.querySelector(".line-through")?.textContent).toBe("You know a barometer can stick. ");

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Restore the original reply"]')!.click(),
    );
    expect(onEdit).toHaveBeenCalledWith("message-1", original);
  });

  it("hides once the original is back or the user has edited the reply since", () => {
    render(original, vi.fn());
    expect(container.textContent).toBe("");

    render("Kaul taps the glass. The user rewrote this line.", vi.fn());
    expect(container.textContent).toBe("");
  });
});
