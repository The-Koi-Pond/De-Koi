import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FanficEditorReport } from "../../../../engine/modes/fanfic/editor";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import type { FanficEditorController } from "../hooks/use-fanfic";
import { FanficEditorPanel } from "./FanficEditorPanel";

const { report } = vi.hoisted(() => ({ report: { current: null as unknown } }));

vi.mock("../../../catalog/chats/index", () => ({
  useChat: () => ({ data: { id: "fic-1", metadata: { fanficEditor: { version: 1, reports: [report.current] } } } }),
}));
vi.mock("../../../catalog/connections/index", () => ({ HelperRunNote: () => null }));

const TEXT = "Crowley waited. Aziraphale talked about books for a very long time.";
const scores = { escalation: 4, subplot: 6, choices: 5, theme: 7, exposition: 3 };

describe("FanficEditorPanel", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    report.current = {
      chapter: 2,
      messageId: "m2",
      textKey: fanficChapterTextKey(TEXT),
      scores,
      notes: { escalation: "Flat.", subplot: "-", choices: "-", theme: "-", exposition: "Recap." },
      flags: [
        {
          dimension: "exposition",
          startQuote: "Aziraphale talked",
          endQuote: "long time.",
          problem: "A recap.",
          direction: "Cut it down.",
        },
      ],
      dropped: 0,
    } satisfies FanficEditorReport;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  async function render(blocked: string | null) {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <FanficEditorPanel
          chatId="fic-1"
          chapters={[{ messageId: "m2", content: TEXT, label: "2", mainNumber: 2, extra: null, position: 1 }]}
          controller={
            { running: null, progress: null, run: vi.fn(), rewrite: vi.fn(), stop: vi.fn() } as FanficEditorController
          }
          busy={false}
          blocked={blocked}
          onRewritten={vi.fn()}
        />,
      );
    });
  }

  const rewriteButton = () =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Rewrite this scene"),
    );

  it("lets a flagged scene be rewritten", async () => {
    await render(null);

    expect(rewriteButton()?.disabled).toBe(false);
  });

  it("holds scene rewrites with the reason while a chapter is unfinished", async () => {
    const reason = "Chapter 1 is unfinished: Reset, Continue or Keep it as is first.";
    await render(reason);

    expect(rewriteButton()?.disabled).toBe(true);
    expect(container.textContent).toContain(reason);
  });
});
