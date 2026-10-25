import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../../../engine/contracts/types/chat";
import type { FanficState, FanficUnfinished, FanficVersion } from "../../../../engine/contracts/types/fanfic";
import { createFanficState, defaultFanficRequest } from "../../../../engine/modes/fanfic/request";
import type {
  FanficEditorController,
  FanficLedgerController,
  FanficPhraseBanController,
  FanficPlanController,
  FanficVoicesController,
} from "../hooks/use-fanfic";
import { FanficReader } from "./FanficReader";

const { mutation, checks, keep } = vi.hoisted(() => ({
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
}));

vi.mock("../../../catalog/chats/index", () => ({
  useChat: () => ({ data: { id: "fic-1", connectionId: "conn-1", metadata: {} } }),
  useDeleteMessage: mutation,
  useSetActiveSwipe: mutation,
  useUpdateMessage: mutation,
}));
vi.mock("../../../catalog/connections/index", () => ({ HelperRunNote: () => null }));
vi.mock("../../../runtime/generation/index", () => ({ GenerationFailureNotice: () => null }));
vi.mock("./FanficConnectionSelect", () => ({ FanficReaderConnectionSelect: () => <span data-model-control="" /> }));
vi.mock("./FanficQualityPanel", () => ({ FanficQualityPanel: () => null }));
vi.mock("../../../../shared/api/file-save-api", () => ({ saveTextFileToUserSelectedLocation: vi.fn() }));
vi.mock("../hooks/use-fanfic", () => ({
  fanficChapterViewRefs: () => [],
  useFanficContinuity: checks,
  useFanficVoiceCheck: checks,
  useFanficKeepVersion: () => keep,
}));
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

describe("FanficReader", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    keep.mutate.mockReset();
    chapterFinished.mockReset();
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
      root.render(
        <QueryClientProvider client={queryClient}>
          <FanficReader
            chatId="fic-1"
            chatName="Snow Day"
            state={state}
            chapters={messages.map((message, index) => ({ number: index + 1, message }))}
            generating={false}
            streamText=""
            phase={null}
            regeneratingMessageId={null}
            continuing={null}
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
        </QueryClientProvider>,
      );
    });
    return onWrite;
  }

  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
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

    it("disables the notice's controls while a write runs", async () => {
      await render([chapterMessage("m1", "The lamp flickered,", { unfinished: CUT })], { generating: true });

      for (const label of ["Reset", "Continue", "Keep as is"]) expect(button(label)?.disabled).toBe(true);
    });
  });
});
