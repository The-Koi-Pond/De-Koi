import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../shared/components/ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { HelpHub } from "./HelpHub";

describe("HelpHub guided setup action", () => {
  it("offers the optional tour without implying setup completion", () => {
    const html = renderToStaticMarkup(
      <HelpHub open onClose={vi.fn()} onOpenHealth={vi.fn()} onReplayOnboarding={vi.fn()} />,
    );

    expect(html).toContain("Show me around");
    expect(html).toContain("readiness checklist");
    expect(html).not.toContain("Replay onboarding");
  });
});
