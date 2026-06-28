import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleEditor } from "./ScheduleEditor";

describe("ScheduleEditor routine summary", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("shows fuzzy routine labels instead of day-by-day block counts", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <ScheduleEditor
          characterRoutines={{
            "char-1": {
              weekStart: "2026-06-22",
              generatedAt: "2026-06-28T12:00:00.000Z",
              sleep: "usually sleeps from around 1 AM until late morning",
              busy: [{ when: "weekdays after lunch", summary: "classes", availability: "busy" }],
              freeish: ["evenings after 7 PM"],
              replyStyle: "fast when free, slow when busy",
              checkInStyle: "likes texting at night",
              socialEnergy: { level: "medium", reason: "more open after class" },
              inactivityThresholdMinutes: 150,
              talkativeness: 70,
            },
          }}
          characterSchedules={{}}
          chatCharIds={["char-1"]}
          charNameMap={new Map([["char-1", "Mira"]])}
          onSave={vi.fn()}
        />,
      );
    });

    expect(container!.textContent).toContain("Sleep");
    expect(container!.textContent).toContain("Busy");
    expect(container!.textContent).toContain("Free-ish");
    expect(container!.textContent).toContain("Reply style");
    expect(container!.textContent).toContain("Check-in style");
    expect(container!.textContent).toContain("classes");
    expect(container!.textContent).not.toContain("availability block");
    expect(container!.textContent).not.toContain("Monday");
  });
});
