import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FanficChapterContinuityCheck,
  FanficChapterContinuityIssue,
} from "../../../../engine/modes/fanfic/continuity";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { FanficContinuityResult } from "./FanficContinuityResult";

const TEXT = "Mira says the door was always red, and nobody argues.";

function issue(overrides: Partial<FanficChapterContinuityIssue> = {}): FanficChapterContinuityIssue {
  return {
    category: "detail",
    subtype: "",
    earlierChapter: 3,
    earlierQuote: "the door was painted blue",
    laterChapter: 3,
    laterQuote: "the door was always red",
    explanation: "The door can't be both.",
    fix: null,
    ...overrides,
  };
}

function check(issues: FanficChapterContinuityIssue[], overrides: Partial<FanficChapterContinuityCheck> = {}) {
  return {
    chapter: 3,
    label: "3.5",
    messageId: "x3",
    textKey: fanficChapterTextKey(TEXT),
    basis: "chapters",
    chaptersRead: ["1", "2", "3"],
    issues,
    candidates: issues.length,
    ungrounded: 0,
    rejected: 0,
    merged: 0,
    model: { connectionId: "conn-1", name: "Writer", model: "big" },
    ...overrides,
  } satisfies FanficChapterContinuityCheck;
}

describe("FanficContinuityResult", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  async function render(result: FanficChapterContinuityCheck, labels: Record<string, string>) {
    const onRewrite = vi.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <FanficContinuityResult
          check={result}
          labels={new Map(Object.entries(labels))}
          chapterText={TEXT}
          busy={false}
          onFix={vi.fn()}
          onRewrite={onRewrite}
          onDismiss={vi.fn()}
        />,
      );
    });
    return onRewrite;
  }

  const rewriteButton = () =>
    Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Rewrite with this note"),
    )!;

  it("shows and rewrites a slip against an extra by the extra's label, not its main chapter's number", async () => {
    const onRewrite = await render(
      check([issue({ earlierChapter: 1, earlierMessageId: "x1", laterChapter: 2, laterMessageId: "m2" })], {
        chapter: 2,
        label: "2",
        messageId: "m2",
      }),
      { m1: "1", x1: "1.5", m2: "2" },
    );

    expect(container.textContent).toContain("Ch 1.5:");
    await act(async () => rewriteButton().click());
    expect(onRewrite.mock.calls[0]![0]).toContain('Earlier, chapter 1.5 says: "the door was painted blue"');
  });

  it("says a slip's earlier chapter was deleted rather than naming its stored number", async () => {
    const onRewrite = await render(
      check([issue({ earlierChapter: 1, earlierMessageId: "x1", laterChapter: 2, laterMessageId: "m2" })], {
        chapter: 2,
        label: "2",
        messageId: "m2",
      }),
      { m1: "1", m2: "2" },
    );

    expect(container.textContent).toContain("A deleted chapter:");
    expect(container.textContent).not.toContain("Ch 1:");
    await act(async () => rewriteButton().click());
    expect(onRewrite.mock.calls[0]![0]).toContain('Earlier, a deleted chapter says: "the door was painted blue"');
  });

  it("names an earlier main chapter by its label when an extra after it is checked", async () => {
    await render(check([issue({ earlierMessageId: "m3", laterMessageId: "x3" })]), { m3: "3", x3: "3.5" });

    expect(container.textContent).toContain("Ch 3:");
    expect(container.textContent).not.toContain("Earlier in this chapter");
    expect(container.textContent).toContain("against the chapters before chapter 3.5");
  });

  it("calls a slip inside the checked chapter earlier in this chapter by its message id", async () => {
    await render(check([issue({ earlierMessageId: "x3", laterMessageId: "x3" })]), { m3: "3", x3: "3.5" });

    expect(container.textContent).toContain("Earlier in this chapter:");
  });

  it("shows the label the chapters have now after extras are renumbered", async () => {
    const renumbered = check([issue({ earlierChapter: 3, earlierMessageId: "x7", laterMessageId: "x8" })], {
      label: "3.7",
      messageId: "x8",
    });
    await render(renumbered, { x7: "3.5", x8: "3.6" });

    expect(container.textContent).toContain("Ch 3.5:");
    expect(container.textContent).toContain("against the chapters before chapter 3.6");
  });

  it("shows the stored number of an issue saved without message ids", async () => {
    await render(check([issue({ earlierChapter: 2 })], { chapter: 4, label: "4", messageId: "m4" }), { m4: "4" });

    expect(container.textContent).toContain("Ch 2:");
    expect(container.textContent).toContain("against chapters 1–3");
  });
});
