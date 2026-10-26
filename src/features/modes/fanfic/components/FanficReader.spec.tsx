import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../../../engine/contracts/types/chat";
import type { FanficState, FanficUnfinished, FanficVersion } from "../../../../engine/contracts/types/fanfic";
import { fanficChapterLayout } from "../../../../engine/modes/fanfic/chapter-refs";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { detectFanficRepetition } from "../../../../engine/modes/fanfic/repetition";
import { createFanficState, defaultFanficRequest } from "../../../../engine/modes/fanfic/request";
import type {
  FanficEditorController,
  FanficLedgerController,
  FanficPhraseBanController,
  FanficPlanController,
  FanficVoicesController,
} from "../hooks/use-fanfic";
import { FanficReader } from "./FanficReader";

const { mutation, checks, keep, canon, deleting, confirm, chat } = vi.hoisted(() => ({
  chat: { metadata: {} as Record<string, unknown> },
  mutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
  checks: () => ({
    check: () => {},
    stop: () => {},
    running: null,
    phase: null,
    results: {},
    dismiss: () => {},
    applyFixes: async () => {},
    fixing: false,
  }),
  keep: { mutate: vi.fn(), isPending: false },
  canon: { mutate: vi.fn(), isPending: false },
  deleting: { mutate: vi.fn(), isPending: false },
  confirm: vi.fn(),
}));

vi.mock("../../../catalog/chats/index", () => ({
  useChat: () => ({ data: { id: "fic-1", connectionId: "conn-1", metadata: chat.metadata } }),
  useSetActiveSwipe: mutation,
  useUpdateMessage: mutation,
}));
vi.mock("../../../catalog/connections/index", () => ({ HelperRunNote: () => null }));
vi.mock("../../../runtime/generation/index", () => ({ GenerationFailureNotice: () => null }));
vi.mock("./FanficConnectionSelect", () => ({ FanficReaderConnectionSelect: () => <span data-model-control="" /> }));
vi.mock("./FanficQualityPanel", () => ({ FanficQualityPanel: () => null }));
vi.mock("../../../../shared/api/file-save-api", () => ({ saveTextFileToUserSelectedLocation: vi.fn() }));
vi.mock("../../../../shared/lib/app-dialogs", () => ({ showConfirmDialog: confirm }));
vi.mock("../hooks/use-fanfic", () => ({
  useFanficContinuity: checks,
  useFanficVoiceCheck: checks,
  useFanficKeepVersion: () => keep,
  useFanficExtraCanon: () => canon,
  useFanficDeleteChapter: () => deleting,
}));
vi.mock("../../../../engine/modes/fanfic/repetition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../engine/modes/fanfic/repetition")>();
  return { ...actual, detectFanficRepetition: vi.fn(actual.detectFanficRepetition) };
});
vi.mock("../hooks/use-fanfic-narration", () => ({
  useFanficNarration: () => ({ config: null, currentPart: null, stop: vi.fn() }),
}));

const state: FanficState = {
  ...createFanficState({ ...defaultFanficRequest(), fandom: "Good Omens", chapterCount: 3 }),
  outline: {
    title: "Snow Day",
    summary: "",
    chapters: [
      { number: 1, title: "First Flakes", summary: "" },
      { number: 2, title: "Thaw", summary: "" },
      { number: 3, title: "Spring", summary: "" },
    ],
  },
  outlineApproved: true,
};

const chapterFinished = vi.fn();
const EDITED = "Mira waited. Mira talked about the war for a very long time.";
const CUT: FanficUnfinished = {
  reason: "content_filter",
  code: "llm_stream_incomplete",
  message: "Blocked by safety.",
};

function chapterMessage(
  id: string,
  content: string,
  version: Partial<FanficVersion> = {},
  versions = { count: 1, shown: 0 },
): Message {
  const fanficVersion: FanficVersion = {
    models: [{ connectionId: "conn-1", name: "Writer", model: "big" }],
    origin: { kind: "chapter", notes: "" },
    unfinished: null,
    ...version,
  };
  return {
    id,
    chatId: "fic-1",
    role: "assistant",
    content,
    swipeCount: versions.count,
    activeSwipeIndex: versions.shown,
    extra: { fanficVersion },
  } as unknown as Message;
}

/** An extra chapter after main chapter `parentChapter`, written as an extra unless `version` says otherwise. */
function extraMessage(
  id: string,
  content: string,
  parentChapter: number,
  version: Partial<FanficVersion> = {},
  canon = false,
) {
  const message = chapterMessage(id, content, { origin: { kind: "extra", notes: "" }, ...version });
  return {
    ...message,
    extra: { ...message.extra, fanficExtra: { parentChapter, canon } },
  } as unknown as Message;
}

describe("FanficReader", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    keep.mutate.mockReset();
    canon.mutate.mockReset();
    deleting.mutate.mockReset();
    confirm.mockReset();
    chapterFinished.mockReset();
    chat.metadata = {};
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    queryClient.clear();
    container.remove();
  });

  async function render(messages: Message[], props: Partial<ComponentProps<typeof FanficReader>> = {}) {
    const onWrite = vi.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(reader(messages, props, onWrite));
    });
    return onWrite;
  }

  /** Renders the same reader again with new messages or props, keeping its state (the chapter in view). */
  async function rerender(messages: Message[], props: Partial<ComponentProps<typeof FanficReader>> = {}) {
    await act(async () => root!.render(reader(messages, props, vi.fn())));
  }

  function reader(
    messages: Message[],
    props: Partial<ComponentProps<typeof FanficReader>>,
    onWrite: ComponentProps<typeof FanficReader>["onWrite"],
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <FanficReader
          chatId="fic-1"
          chatName="Snow Day"
          state={state}
          chapters={fanficChapterLayout(messages.map((message) => ({ ...message }))).chapters.map((chapter) => ({
            number: chapter.mainNumber,
            message: messages.find((message) => message.id === chapter.messageId)!,
          }))}
          generating={false}
          streamText=""
          phase={null}
          regeneratingMessageId={null}
          continuing={null}
          writingExtraAfter={null}
          onWrite={onWrite}
          onChapterFinished={chapterFinished}
          onRetry={vi.fn()}
          onStop={vi.fn()}
          ledger={{} as FanficLedgerController}
          voices={{} as FanficVoicesController}
          onSaveVoices={vi.fn()}
          editor={{} as FanficEditorController}
          plan={{ running: false, propose: vi.fn() } as unknown as FanficPlanController}
          phraseBans={{ supported: false } as FanficPhraseBanController}
          onSaveBannedPhrases={vi.fn()}
          onUsePlan={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    );
  }

  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  const headings = () => Array.from(container.querySelectorAll("article h3")).map((item) => item.textContent);
  /** Picks a chapter (by message id) or "all" in the chapter navigation. */
  const showChapter = async (value: string) => {
    const select = container.querySelector<HTMLSelectElement>("#fanfic-chapter-select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const notice = () => container.querySelector("[aria-label='Unfinished chapter']");
  const click = async (element: Element | undefined) => {
    await act(async () => {
      (element as HTMLElement).click();
    });
  };
  const type = async (field: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  describe("while a chapter is continued", () => {
    it("shows the chapter's text so far with the new text streaming after it", async () => {
      await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT })], {
        generating: true,
        streamText: "and went",
        continuing: { messageId: "m1", textSoFar: "The lamp flickered," },
      });

      const streaming = container.querySelectorAll("article[aria-busy='true']");
      expect(streaming).toHaveLength(1);
      expect(streaming[0]!.textContent).toContain("Chapter 1: First Flakes");
      expect(streaming[0]!.textContent).toContain("The lamp flickered, and went");
      expect(container.textContent).not.toContain("Chapter 2");
    });

    it("says it is writing until the first new words arrive", async () => {
      await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT })], {
        generating: true,
        continuing: { messageId: "m1", textSoFar: "The lamp flickered," },
      });

      const streaming = container.querySelector("article[aria-busy='true']")!;
      expect(streaming.textContent).toContain("The lamp flickered,");
      expect(streaming.querySelector("[role='status']")?.textContent).toContain("Writing…");
    });
  });

  describe("with extra chapters", () => {
    it("shows an extra on its own page after its main chapter, headed with its number, with its own chapter tools", async () => {
      const onWrite = await render([
        chapterMessage("m1", "One."),
        chapterMessage("m2", "Two."),
        chapterMessage("m3", "Three."),
        extraMessage("x3", "Mira remembers.", 3),
      ]);

      expect(headings()).toEqual(["Chapter 3: Spring"]);
      await click(container.querySelector("[aria-label='Next chapter']")!);
      expect(headings()).toEqual(["Chapter 3.5"]);
      expect(container.textContent).not.toContain("Three.");
      const redoButtons = Array.from(container.querySelectorAll("button")).filter(
        (item) => item.textContent?.trim() === "Redo",
      );
      expect(redoButtons).toHaveLength(1);
      await click(redoButtons[0]);
      expect(onWrite).toHaveBeenCalledWith({ kind: "regenerate", messageId: "x3" });
    });

    it("shows the entire work in reading order, extras after their main chapter", async () => {
      await render([
        chapterMessage("m1", "One."),
        chapterMessage("m2", "Two."),
        extraMessage("x1", "Mira remembers.", 1),
      ]);

      await showChapter("all");
      expect(headings()).toEqual(["Chapter 1: First Flakes", "Chapter 1.5", "Chapter 2: Thaw"]);
    });

    it("writes an extra after a main chapter from a box for its next number, without planning ahead", async () => {
      const onWrite = await render([
        chapterMessage("m1", "One."),
        chapterMessage("m2", "Two."),
        chapterMessage("m3", "Three."),
        extraMessage("x3", "Mira remembers.", 3),
      ]);
      const offers = Array.from(container.querySelectorAll("button")).filter(
        (item) => item.textContent?.trim() === "Write extra chapter",
      );
      expect(offers).toHaveLength(1);

      await click(offers[0]);
      const box = container.querySelector<HTMLElement>("[aria-label='Extra chapter 3.6']");
      expect(box?.textContent).toContain("Extra chapter 3.6");
      expect(box?.textContent).not.toContain("Re-plan the rest");
      await type(box!.querySelector("textarea")!, "A flashback.");
      await click(button("Write chapter 3.6"));

      expect(onWrite).toHaveBeenCalledWith({ kind: "extra", parentChapter: 3, notes: "A flashback." });
    });

    it("streams a new extra after its main chapter's chain, not as the next chapter", async () => {
      await render([chapterMessage("m1", "One."), chapterMessage("m2", "Two.")], {
        generating: true,
        streamText: "Mira",
        writingExtraAfter: 2,
      });

      const streaming = container.querySelectorAll("article[aria-busy='true']");
      expect(streaming).toHaveLength(1);
      expect(streaming[0]!.querySelector("h3")?.textContent).toBe("Chapter 2.5");
      expect(container.textContent).not.toContain("Chapter 3");
    });

    it("streams a new extra on its own page, after its chain in the entire work, and opens it once written", async () => {
      const written = [
        chapterMessage("m1", "One."),
        extraMessage("x1", "Mira remembers.", 1),
        chapterMessage("m2", "Two."),
      ];
      await render(written, { generating: true, streamText: "Mira", writingExtraAfter: 1 });
      await showChapter("m1");
      expect(headings()).toEqual(["Chapter 1.6"]);
      await showChapter("all");
      expect(headings()).toEqual(["Chapter 1: First Flakes", "Chapter 1.5", "Chapter 1.6", "Chapter 2: Thaw"]);
      await showChapter("m1");

      await rerender([...written, extraMessage("x2", "Mira forgets.", 1)]);
      expect(headings()).toEqual(["Chapter 1.6"]);
      expect(container.textContent).toContain("Mira forgets.");
    });

    it("disables writing an extra while a write runs", async () => {
      await render([chapterMessage("m1", "One.")], { generating: true });

      expect(button("Write extra chapter")?.disabled).toBe(true);
    });

    it("shows a new extra's stream only on its chain's pages, and any other chapter as it is", async () => {
      await render(
        [chapterMessage("m1", "One."), extraMessage("x1", "Mira remembers.", 1), chapterMessage("m2", "Two.")],
        {
          generating: true,
          streamText: "Mira",
          writingExtraAfter: 1,
        },
      );

      expect(headings()).toEqual(["Chapter 2: Thaw"]);
      expect(container.querySelector("article[aria-busy='true']")).toBeNull();
      await showChapter("x1");
      expect(headings()).toEqual(["Chapter 1.6"]);
      await showChapter("m1");
      expect(headings()).toEqual(["Chapter 1.6"]);
    });

    it("checks each chapter for repeats once, not again on every render", async () => {
      const messages = [
        chapterMessage("m1", "One."),
        extraMessage("x1", "Mira remembers.", 1),
        chapterMessage("m2", "Two."),
      ];
      const chapters = fanficChapterLayout(messages.map((message) => ({ ...message }))).chapters.map((chapter) => ({
        number: chapter.mainNumber,
        message: messages.find((message) => message.id === chapter.messageId)!,
      }));
      await render(messages, { chapters });
      await showChapter("all");
      const calls = vi.mocked(detectFanficRepetition).mock.calls.length;

      await rerender(messages, { chapters, streamText: "Unrelated." });

      expect(vi.mocked(detectFanficRepetition).mock.calls.length).toBe(calls);
    });
  });

  describe("canon extra chapters", () => {
    const canonBoxes = () => Array.from(container.querySelectorAll<HTMLInputElement>("article input[type='checkbox']"));
    const continuesFrom = () => container.querySelector<HTMLSelectElement>("#fanfic-continues-from");
    const choose = async (select: HTMLSelectElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    const chain = (first: boolean, second: boolean) => [
      chapterMessage("m1", "One."),
      chapterMessage("m2", "Two."),
      chapterMessage("m3", "Three."),
      extraMessage("x5", "Mira remembers.", 3, {}, first),
      extraMessage("x6", "Mira forgets.", 3, {}, second),
    ];

    it("offers a canon checkbox on each extra only, showing whether later chapters build on it", async () => {
      await render(chain(false, true));
      await showChapter("all");

      const boxes = canonBoxes();
      expect(boxes).toHaveLength(2);
      // 3.6 is stored canon but follows a side story, so it isn't canon.
      expect(boxes.map((box) => box.checked)).toEqual([false, false]);
      await click(boxes[0]);
      expect(canon.mutate).toHaveBeenCalledWith({ messageId: "x5", canon: true });
    });

    it("unmarks a canon extra from its checkbox", async () => {
      await render(chain(true, true));
      await showChapter("all");

      expect(canonBoxes().map((box) => box.checked)).toEqual([true, true]);
      await click(canonBoxes()[1]);
      expect(canon.mutate).toHaveBeenCalledWith({ messageId: "x6", canon: false });
    });

    it("disables the canon checkbox while a write runs, and keeps it while a chapter is unfinished", async () => {
      await render(chain(false, false), { generating: true });
      await showChapter("all");
      expect(canonBoxes()).toHaveLength(2);
      expect(canonBoxes().every((box) => box.disabled)).toBe(true);
      act(() => root?.unmount());

      await render([chapterMessage("m1", "One."), extraMessage("x5", "Mira", 1, { unfinished: CUT })]);
      await showChapter("x5");
      expect(canonBoxes()[0]?.disabled).toBe(false);
    });

    it("shows the next chapter continuing from the end of the last main chapter, and switches to its latest extra", async () => {
      await render(chain(false, false));

      const select = continuesFrom()!;
      expect(select.selectedOptions[0]?.textContent).toBe("End of chapter 3");
      expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
        "End of chapter 3",
        "End of chapter 3.6",
      ]);
      await choose(select, "3.6");
      expect(canon.mutate).toHaveBeenCalledWith({ parentChapter: 3, canon: true });
    });

    it("shows the next chapter continuing from the last canon extra, and switches back to the main chapter", async () => {
      await render(chain(true, true));

      expect(continuesFrom()?.selectedOptions[0]?.textContent).toBe("End of chapter 3.6");
      await choose(continuesFrom()!, "3");
      expect(canon.mutate).toHaveBeenCalledWith({ parentChapter: 3, canon: false });
    });

    it("names a canon extra in the middle of the chain as what the next chapter continues from", async () => {
      await render(chain(true, false));

      expect(continuesFrom()?.selectedOptions[0]?.textContent).toBe("End of chapter 3.5");
    });

    it("offers no continues-from choice when the last main chapter has no extras", async () => {
      await render([chapterMessage("m1", "One."), extraMessage("x5", "Mira", 1), chapterMessage("m2", "Two.")]);

      expect(button("Write chapter 3")).toBeDefined();
      expect(continuesFrom()).toBeNull();
    });
  });

  describe("navigating extra chapters", () => {
    const select = () => container.querySelector<HTMLSelectElement>("#fanfic-chapter-select")!;
    const options = () => Array.from(select().options).map((option) => option.textContent);
    const choose = showChapter;
    const chipped = () =>
      Array.from(container.querySelectorAll("article"))
        .filter((article) => article.textContent?.includes("Side story"))
        .map((article) => article.querySelector("h3")?.textContent);

    it("lists extras in reading order, marking side stories, and steps through them", async () => {
      await render([
        chapterMessage("m1", "One."),
        chapterMessage("m2", "Two."),
        chapterMessage("m3", "Three."),
        chapterMessage("m4", "Four."),
        extraMessage("x2", "Mira remembers.", 2, {}, true),
        extraMessage("x3", "Mira forgets.", 3),
      ]);

      expect(options()).toEqual([
        "Entire work",
        "Chapter 1: First Flakes",
        "Chapter 2: Thaw",
        "Chapter 2.5",
        "Chapter 3: Spring",
        "Chapter 3.5 (side story)",
        "Chapter 4",
      ]);
      expect(headings()).toEqual(["Chapter 4"]);
      await click(container.querySelector("[aria-label='Previous chapter']")!);
      expect(select().value).toBe("x3");
      expect(headings()).toEqual(["Chapter 3.5"]);
      await click(container.querySelector("[aria-label='Previous chapter']")!);
      expect(headings()).toEqual(["Chapter 3: Spring"]);
      await click(container.querySelector("[aria-label='Next chapter']")!);
      expect(headings()).toEqual(["Chapter 3.5"]);
      await click(container.querySelector("[aria-label='Next chapter']")!);
      expect(headings()).toEqual(["Chapter 4"]);
    });

    it("marks non-canon extras and orphaned extras as side stories under their heading", async () => {
      await render([
        chapterMessage("m1", "One."),
        extraMessage("x1", "Canon.", 1, {}, true),
        extraMessage("x2", "Side.", 1),
        extraMessage("o4", "Lost.", 4),
      ]);
      await choose("all");

      expect(headings()).toEqual([
        "Chapter 1: First Flakes",
        "Chapter 1.5",
        "Chapter 1.6",
        "Extra chapter (chapter 4 is gone)",
      ]);
      expect(chipped()).toEqual(["Chapter 1.6", "Extra chapter (chapter 4 is gone)"]);
    });

    it("lists an extra whose main chapter is gone last, readable, with reading tools only", async () => {
      const orphan = { ...extraMessage("o3", "Lost words.", 3), swipeCount: 2, activeSwipeIndex: 1 } as Message;
      await render([chapterMessage("m1", "One."), orphan, chapterMessage("m2", "Two.")]);

      expect(options().at(-1)).toBe("Extra chapter (chapter 3 is gone) (side story)");
      await choose("o3");
      expect(headings()).toEqual(["Extra chapter (chapter 3 is gone)"]);
      expect(container.textContent).toContain("Lost words.");
      expect(container.querySelector<HTMLButtonElement>("[aria-label='Previous version']")?.disabled).toBe(false);
      for (const label of ["Redo", "Rewrite with notes", "Write extra chapter", "Edit", "Check continuity"]) {
        expect(button(label)).toBeUndefined();
      }
      expect(container.querySelector("article input[type='checkbox']")).toBeNull();
      // Deleting it needs nothing from the missing chapter, so it stays.
      expect(button("Delete")).toBeDefined();
    });

    it("names ledger entries by the label of the chapter at their place on the canon line", async () => {
      const entry = (chapter: number, messageId: string, content: string) => ({
        chapter,
        messageId,
        textKey: fanficChapterTextKey(content),
        summary: `Summary ${chapter}.`,
        timeline: "",
        knowledge: [],
        conditions: [],
        relationships: [],
        openThreads: [],
      });
      chat.metadata = {
        fanficLedger: { version: 1, entries: [entry(1, "m1", "One."), entry(2, "x1", "Canon.")] },
      };
      await render([
        chapterMessage("m1", "One."),
        extraMessage("x1", "Canon.", 1, {}, true),
        extraMessage("x2", "Side.", 1),
        chapterMessage("m2", "Two."),
      ]);
      await click(button("Ledger"));

      const panel = container.querySelector("[aria-label='Story ledger']")!;
      expect(panel.textContent).toContain("Up to date through chapter 1.5. Chapter 2 isn't in it yet.");
      expect(panel.textContent).toContain("Chapter 1.5. Summary 2.");
    });

    it("names an editor report by its chapter's label and opens that chapter after its rewrite", async () => {
      chat.metadata = {
        fanficEditor: {
          version: 1,
          reports: [
            {
              chapter: 3,
              messageId: "x3",
              textKey: fanficChapterTextKey(EDITED),
              scores: { escalation: 4, subplot: 6, choices: 5, theme: 7, exposition: 3 },
              notes: { escalation: "-", subplot: "-", choices: "-", theme: "-", exposition: "Recap." },
              flags: [
                {
                  dimension: "exposition",
                  startQuote: "Mira talked",
                  endQuote: "long time.",
                  problem: "A recap.",
                  direction: "Cut it.",
                },
              ],
              dropped: 0,
            },
          ],
        },
      };
      const editor = {
        running: null,
        progress: null,
        run: vi.fn(),
        rewrite: vi.fn((_report: unknown, done: () => void) => done()),
        stop: vi.fn(),
      } as unknown as FanficEditorController;
      await render(
        [
          chapterMessage("m1", "One."),
          chapterMessage("m2", "Two."),
          chapterMessage("m3", "Three."),
          extraMessage("x3", EDITED, 3),
          chapterMessage("m4", "Four."),
        ],
        { editor },
      );
      await click(button("Editor"));

      const panel = container.querySelector("[aria-label='Editor pass']")!;
      expect(panel.textContent).toContain("Ch 3.5");
      await click(button("Rewrite this scene"));
      expect(select().value).toBe("x3");
      expect(headings()).toEqual(["Chapter 3.5"]);
    });
  });

  describe("deleting chapters", () => {
    const chain = [
      chapterMessage("m1", "One."),
      chapterMessage("m2", "Two."),
      chapterMessage("m3", "Three."),
      extraMessage("x5", "Mira remembers.", 3),
      extraMessage("x6", "Mira forgets.", 3),
    ];
    const asked = () => confirm.mock.calls.map(([options]) => (options as { message: string }).message);

    it("asks to delete an extra by its label and deletes it once confirmed", async () => {
      confirm.mockResolvedValue(true);
      await render(chain);
      await showChapter("x5");

      await click(button("Delete"));

      expect(asked()).toEqual(["Delete chapter 3.5? This can't be undone."]);
      expect(deleting.mutate).toHaveBeenCalledWith("x5");
    });

    it("names the last main chapter's extras, deletes nothing on cancel, and the chapter with its extras on confirm", async () => {
      confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await render(chain);

      await click(button("Delete"));
      expect(asked()).toEqual(["Delete chapter 3 and its extra chapters 3.5 and 3.6? This can't be undone."]);
      expect(deleting.mutate).not.toHaveBeenCalled();

      await click(button("Delete"));
      expect(deleting.mutate).toHaveBeenCalledTimes(1);
      expect(deleting.mutate).toHaveBeenCalledWith("m3");
    });

    it("asks as before for a last main chapter without extras, and offers no Delete on earlier ones", async () => {
      confirm.mockResolvedValue(false);
      await render([
        chapterMessage("m1", "One."),
        extraMessage("x5", "Mira remembers.", 1),
        chapterMessage("m2", "Two."),
      ]);

      await click(button("Delete"));
      expect(asked()).toEqual(["Delete chapter 2? This can't be undone."]);
      await showChapter("m1");
      expect(button("Delete")).toBeUndefined();
      await showChapter("x5");
      expect(button("Delete")).toBeDefined();
    });

    it("deletes an extra whose main chapter is gone", async () => {
      confirm.mockResolvedValue(true);
      await render([chapterMessage("m1", "One."), extraMessage("o3", "Lost words.", 3)]);
      await showChapter("o3");

      await click(button("Delete"));

      expect(asked()).toEqual(["Delete this extra chapter? Its main chapter is gone. This can't be undone."]);
      expect(deleting.mutate).toHaveBeenCalledWith("o3");
    });

    it("opens the chapter before a deleted one in reading order", async () => {
      const written = [
        chapterMessage("m1", "One."),
        extraMessage("x1", "Mira remembers.", 1),
        chapterMessage("m2", "Two."),
        chapterMessage("m3", "Three."),
      ];
      await render(written);
      await showChapter("x1");

      await rerender(written.filter((message) => message.id !== "x1"));

      expect(headings()).toEqual(["Chapter 1: First Flakes"]);
    });

    it("disables Delete while a write runs, and keeps it while a chapter is unfinished", async () => {
      await render(chain, { generating: true });
      expect(button("Delete")?.disabled).toBe(true);
      act(() => root?.unmount());

      await render([chapterMessage("m1", "One."), extraMessage("x5", "Mira", 1, { unfinished: CUT })]);
      expect(button("Delete")?.disabled).toBe(false);
      await showChapter("x5");
      expect(button("Delete")?.disabled).toBe(false);
    });
  });

  describe("with an unfinished chapter", () => {
    it("says why the chapter stopped and offers Reset, Continue, Keep as is and the model", async () => {
      const onWrite = await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT })]);

      expect(notice()?.textContent).toContain("The provider's content filter stopped this chapter.");
      expect(notice()?.textContent).toContain("Blocked by safety.");
      expect(notice()?.querySelector("[data-model-control]")).not.toBeNull();
      await click(button("Continue"));
      expect(onWrite).toHaveBeenCalledWith({ kind: "continue", messageId: "m1" });
      await click(button("Keep as is"));
      expect(keep.mutate).toHaveBeenCalledWith("m1", expect.objectContaining({ onSuccess: expect.any(Function) }));
      expect(chapterFinished).not.toHaveBeenCalled();
      await act(async () => keep.mutate.mock.calls[0]![1].onSuccess());
      // Kept as is, it gets what a finished chapter of its kind gets.
      expect(chapterFinished).toHaveBeenCalledWith({ messageId: "m1", origin: "chapter" });
    });

    it("resets a new chapter from the next-chapter box, filled with its notes", async () => {
      const onWrite = await render([
        chapterMessage("m1", "The lamp flickered,", { unfinished: CUT, origin: { kind: "chapter", notes: "Snow." } }),
      ]);

      await click(button("Reset"));
      const notes = container.querySelector<HTMLTextAreaElement>("#fanfic-reset-notes");
      expect(notes?.value).toBe("Snow.");
      await type(notes!, "Heavier snow.");
      await click(button("Write chapter 1"));

      expect(onWrite).toHaveBeenCalledWith({
        kind: "chapter",
        messageId: "m1",
        replacesVersion: 0,
        notes: "Heavier snow.",
      });
    });

    it("resets a revision from the revise box, filled with its notes", async () => {
      const onWrite = await render([
        chapterMessage(
          "m1",
          "Draft two, cut",
          { unfinished: CUT, origin: { kind: "revise", notes: "Snarkier.", baseVersion: 0 } },
          { count: 2, shown: 1 },
        ),
      ]);

      await click(button("Reset"));
      expect(container.querySelector<HTMLTextAreaElement>("#fanfic-revise-m1")?.value).toBe("Snarkier.");
      await click(button("Write chapter 1 again"));

      expect(onWrite).toHaveBeenCalledWith({ kind: "revise", messageId: "m1", replacesVersion: 1, notes: "Snarkier." });
    });

    it("resets a redo from an empty revise box as a plain redo", async () => {
      const onWrite = await render([
        chapterMessage(
          "m1",
          "Draft two, cut",
          { unfinished: CUT, origin: { kind: "regenerate", notes: "" } },
          { count: 2, shown: 1 },
        ),
      ]);

      await click(button("Reset"));
      expect(container.querySelector<HTMLTextAreaElement>("#fanfic-revise-m1")?.value).toBe("");
      await click(button("Write chapter 1 again"));

      expect(onWrite).toHaveBeenCalledWith({ kind: "regenerate", messageId: "m1", replacesVersion: 1, notes: "" });
    });

    it("disables every other write with the reason, and keeps reading and version switching", async () => {
      await render(
        [
          chapterMessage("m1", "The lamp flickered,", { unfinished: CUT }),
          chapterMessage("m2", "Chapter two.", {}, { count: 2, shown: 1 }),
        ],
        {},
      );

      const reason = "Chapter 1 is unfinished: Reset, Continue or Keep it as is first.";
      expect(container.textContent).toContain(reason);
      expect(button("Redo")?.disabled).toBe(true);
      expect(button("Rewrite with notes")?.disabled).toBe(true);
      expect(button("Write chapter 3")?.disabled).toBe(true);
      expect(container.querySelector<HTMLButtonElement>("[aria-label='Previous version']")?.disabled).toBe(false);
      expect(button("Save as HTML")?.disabled).toBe(false);
    });

    it("resets an extra from its extra box, filled with its notes", async () => {
      const onWrite = await render([
        chapterMessage("m1", "Chapter one."),
        extraMessage("x1", "Mira remembered", 1, { unfinished: CUT, origin: { kind: "extra", notes: "A flashback." } }),
      ]);
      await showChapter("x1");

      await click(button("Reset"));
      const notes = container.querySelector<HTMLTextAreaElement>("#fanfic-reset-notes");
      expect(notes?.value).toBe("A flashback.");
      expect(container.textContent).toContain("Write chapter 1.5 again");
      await type(notes!, "A longer flashback.");
      await click(button("Write chapter 1.5"));

      expect(onWrite).toHaveBeenCalledWith({
        kind: "extra",
        messageId: "x1",
        replacesVersion: 0,
        notes: "A longer flashback.",
      });
    });

    it("resets a version whose origin can't be read from an empty revise box, and keeps it without a plan", async () => {
      const unknown = { kind: "sequel", notes: "Old notes." } as unknown as FanficVersion["origin"];
      const onWrite = await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT, origin: unknown })]);

      await click(button("Reset"));
      expect(container.querySelector("#fanfic-reset-notes")).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>("#fanfic-revise-m1")?.value).toBe("");
      await click(button("Write chapter 1 again"));
      expect(onWrite).toHaveBeenCalledWith({ kind: "regenerate", messageId: "m1", replacesVersion: 0, notes: "" });

      await click(button("Keep as is"));
      await act(async () => keep.mutate.mock.calls[0]![1].onSuccess());
      expect(chapterFinished).toHaveBeenCalledWith({ messageId: "m1", origin: null });
    });

    it("disables writing an extra chapter with the reason", async () => {
      await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT }), chapterMessage("m2", "Two.")]);

      expect(button("Write extra chapter")?.disabled).toBe(true);
      expect(button("Write extra chapter")?.title).toBe(
        "Chapter 1 is unfinished: Reset, Continue or Keep it as is first.",
      );
    });

    it("disables the notice's controls while a write runs", async () => {
      await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT })], { generating: true });

      for (const label of ["Reset", "Continue", "Keep as is"]) expect(button(label)?.disabled).toBe(true);
    });
  });
});
