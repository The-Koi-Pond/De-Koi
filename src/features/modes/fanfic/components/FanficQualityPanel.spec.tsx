import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FanficContinuityIssue,
  FanficQualityCriterionId,
  FanficQualityRun,
} from "../../../../engine/contracts/types/fanfic";
import { fanficChapterLayout } from "../../../../engine/modes/fanfic/chapter-refs";
import { FANFIC_QUALITY_CRITERIA, fanficTextKey, scoreFanficMechanics } from "../../../../engine/modes/fanfic/quality";
import { modelRoutingApi } from "../../../../shared/api/model-routing-api";
import { FanficQualityPanel } from "./FanficQualityPanel";

const mutate = vi.fn();
const { chat } = vi.hoisted(() => ({ chat: { metadata: {} as Record<string, unknown> } }));

vi.mock("../../../catalog/chats/index", () => ({
  useChat: () => ({ data: { id: "fic-1", connectionId: "conn-1", metadata: chat.metadata } }),
}));

vi.mock("../../../catalog/connections/index", () => ({
  HelperRunNote: () => null,
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Writer", provider: "anthropic", model: "big" },
      { id: "conn-2", name: "Judge", provider: "openai", model: "small" },
    ],
  }),
}));

vi.mock("../hooks/use-fanfic", () => ({
  useFanficQuality: () => ({
    run: { mutate, isPending: false },
    remove: { mutate: vi.fn() },
    phase: null,
    stop: vi.fn(),
  }),
}));

vi.mock("../../../../shared/api/model-routing-api", () => ({
  modelRoutingKeys: { settings: ["model-routing"] },
  modelRoutingApi: { get: vi.fn() },
}));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("FanficQualityPanel judge choice", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <FanficQualityPanel
            chatId="fic-1"
            layout={fanficChapterLayout([{ id: "m1", role: "assistant", content: "Chapter one." }])}
            busy={false}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  const judgeSelect = () => document.getElementById("fanfic-quality-judge") as HTMLSelectElement;
  const scoreButton = () =>
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Score this fic"))!;

  it("starts on the fanfic judge route and scores with it", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { judge: "conn-2" } });
    await render();

    expect(judgeSelect().value).toBe("conn-2");
    act(() => scoreButton().click());
    expect(mutate).toHaveBeenCalledWith({ connectionId: "conn-2", rule: "route", label: "" }, expect.anything());
  });

  it("starts on the fic's connection when the judge is not routed", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: {} });
    await render();

    expect(judgeSelect().value).toBe("conn-1");
  });

  it("picks no judge and explains a broken route until one is picked", async () => {
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: { judge: "gone" } });
    await render();

    expect(judgeSelect().value).toBe("");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The Fanfic judge helper is set to a connection that no longer exists.",
    );
    expect(scoreButton().disabled).toBe(true);

    await act(async () => {
      judgeSelect().value = "conn-1";
      judgeSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(scoreButton().disabled).toBe(false);
    // A judge changed by hand is noted as picked for this run, not as the route.
    act(() => scoreButton().click());
    expect(mutate).toHaveBeenCalledWith({ connectionId: "conn-1", rule: "picked", label: "" }, expect.anything());
  });
});

describe("FanficQualityPanel with extra chapters", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(modelRoutingApi.get).mockResolvedValue({ version: 1, routes: {} });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    queryClient.clear();
    container.remove();
    chat.metadata = {};
    vi.clearAllMocks();
  });

  function savedRun(issues: FanficContinuityIssue[] = []): FanficQualityRun {
    return {
      id: "run-1",
      createdAt: "2026-10-17T00:00:00.000Z",
      label: "",
      judgeVersion: 1,
      judge: { connectionId: "conn-1", connectionName: "Writer", model: "big" },
      chapterCount: 2,
      textKey: fanficTextKey(["One.", "Two."]),
      mechanics: scoreFanficMechanics(["One.", "Two."], []),
      rubric: {
        criteria: Object.fromEntries(FANFIC_QUALITY_CRITERIA.map((criterion) => [criterion.id, 10])) as Record<
          FanficQualityCriterionId,
          number
        >,
        groups: { creativity: 5, coherence: 5, character: 5, prose: 5 },
        overall: 5,
        analysis: "",
        passes: 2,
        spread: 0,
      },
      continuity: { issues, candidates: issues.length, ungrounded: 0, rejected: 0, merged: 0, per10k: 0 },
    };
  }

  const message = (id: string, content: string, parentChapter?: number, canon = false) => ({
    id,
    role: "assistant",
    content,
    extra: parentChapter ? { fanficExtra: { parentChapter, canon } } : {},
  });

  async function render(messages: Array<ReturnType<typeof message>>) {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <FanficQualityPanel chatId="fic-1" layout={fanficChapterLayout(messages)} busy={false} />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  const changed = () => container.textContent?.includes("The fic has changed since the last run.");

  it("keeps the last run current when a side story is added, and not once it is marked canon", async () => {
    chat.metadata = { fanficQuality: { runs: [savedRun()] } };
    await render([message("m1", "One."), message("m2", "Two."), message("x2", "Mira.", 2)]);
    expect(changed()).toBe(false);
    act(() => root?.unmount());

    await render([message("m1", "One."), message("m2", "Two."), message("x2", "Mira.", 2, true)]);
    expect(changed()).toBe(true);
  });

  it("names each slip's chapters by their label now, and an old slip by its stored number", async () => {
    const slip = (overrides: Partial<FanficContinuityIssue>): FanficContinuityIssue => ({
      category: "detail",
      subtype: "",
      earlierChapter: 1,
      earlierQuote: "a blue door",
      laterChapter: 2,
      laterQuote: "a red door",
      explanation: "Both can't be true.",
      ...overrides,
    });
    chat.metadata = {
      fanficQuality: {
        runs: [
          savedRun([
            slip({ earlierChapter: 2, earlierMessageId: "x2", laterChapter: 3, laterMessageId: "m3" }),
            slip({ earlierQuote: "an old door", laterQuote: "a new door" }),
          ]),
        ],
      },
    };
    await render([
      message("m1", "One."),
      message("m2", "Two."),
      message("x2", "Mira.", 2, true),
      message("m3", "End."),
    ]);

    const slips = Array.from(container.querySelectorAll("[aria-label='Continuity slips'] li")).map(
      (item) => item.textContent,
    );
    expect(slips[0]).toContain("Ch 2.5:");
    expect(slips[0]).toContain("Ch 3:");
    expect(slips[1]).toContain("Ch 1:");
    expect(slips[1]).toContain("Ch 2:");
  });

  it("says a slip's chapter was deleted rather than naming its stored number", async () => {
    chat.metadata = {
      fanficQuality: {
        runs: [
          savedRun([
            {
              category: "detail",
              subtype: "",
              earlierChapter: 1,
              earlierMessageId: "x1",
              earlierQuote: "a blue door",
              laterChapter: 2,
              laterMessageId: "m2",
              laterQuote: "a red door",
              explanation: "Both can't be true.",
            },
          ]),
        ],
      },
    };
    await render([message("m1", "One."), message("m2", "Two.")]);

    const slip = container.querySelector("[aria-label='Continuity slips'] li")?.textContent;
    expect(slip).toContain("A deleted chapter:");
    expect(slip).not.toContain("Ch 1:");
    expect(slip).toContain("Ch 2:");
  });

  it("says how many chapters a run judged", async () => {
    chat.metadata = { fanficQuality: { runs: [savedRun()] } };
    await render([message("m1", "One."), message("m2", "Two.")]);

    expect(container.textContent).toContain("2 chapters judged");
  });
});
