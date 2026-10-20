import { describe, expect, it } from "vitest";

import {
  enabledChatAgentIds,
  filterAgentIdsForChatMode,
  isBuiltInAgentAvailableInChatMode,
} from "../../contracts/types/agent";
import { getEffectiveMemoryRecallEnabled } from "../../contracts/types/chat";
import type { FanficState } from "../../contracts/types/fanfic";
import { fanficChapterRefs } from "./chapters";
import { buildFanficHtml, buildFanficMarkdown } from "./export";
import {
  approveFanficOutline,
  FanficOutlineCountError,
  FanficOutlineParseError,
  parseFanficOutlineReply,
} from "./outline";
import {
  buildFanficChapterGuide,
  buildFanficOutlineMessages,
  buildFanficRevisionGuide,
  FANFIC_OUTLINE_PLOT_RULES,
  buildFanficSystemSegments,
  labelFanficChapterHistory,
  renderFanficCastCards,
  stripFanficChapterHeading,
} from "./prompts";
import {
  createFanficState,
  defaultFanficRequest,
  fanficRequestProblems,
  fanficStage,
  normalizeFanficRequest,
  readFanficState,
} from "./request";

function writingState(overrides: Partial<FanficState["request"]> = {}): FanficState {
  return {
    version: 1,
    request: normalizeFanficRequest({
      ...defaultFanficRequest(),
      fandom: "Good Omens",
      relationships: ["Aziraphale/Crowley"],
      prompt: "Snowed in at the bookshop.",
      chapterCount: 2,
      ...overrides,
    }),
    outline: {
      title: "Snow Day",
      summary: "Neither of them will admit it's on purpose.",
      chapters: [
        { number: 1, title: "First Flakes", summary: "Crowley arrives as the snow starts." },
        { number: 2, title: "Thaw", summary: "They finally talk." },
      ],
    },
    outlineApproved: true,
    research: null,
  };
}

describe("fanfic request", () => {
  it("clamps lengths, drops unknown enums, and de-duplicates tags", () => {
    const request = normalizeFanficRequest({
      fandom: "  Hades  ",
      rating: "nc-17",
      warnings: ["graphic_violence", "underage", "graphic_violence"],
      tags: ["Slow Burn", "slow burn", " ", "Angst"],
      chapterCount: 400,
      wordsPerChapter: "10",
    });
    expect(request.fandom).toBe("Hades");
    expect(request.rating).toBe("teen");
    expect(request.warnings).toEqual(["graphic_violence"]);
    expect(request.tags).toEqual(["Slow Burn", "Angst"]);
    expect(request.chapterCount).toBe(30);
    expect(request.wordsPerChapter).toBe(500);
  });

  it("blocks mature and explicit requests until adults are confirmed", () => {
    const base = { ...defaultFanficRequest(), fandom: "Hades", prompt: "A night in." };
    expect(fanficRequestProblems({ ...base, rating: "explicit" })).toContain(
      "Mature and Explicit fics need confirmation that every character in sexual content is an adult.",
    );
    expect(fanficRequestProblems({ ...base, rating: "explicit", adultsConfirmed: true })).toEqual([]);
    expect(fanficRequestProblems({ ...base, rating: "teen" })).toEqual([]);
  });

  it("walks request -> outline -> review -> writing", () => {
    expect(fanficStage(null)).toBe("request");
    const fresh = createFanficState({ ...defaultFanficRequest(), fandom: "Hades" });
    expect(fanficStage(fresh)).toBe("outline");
    const outlined = { ...writingState(), outlineApproved: false };
    expect(fanficStage(outlined)).toBe("outline_review");
    expect(fanficStage(writingState())).toBe("writing");
  });

  it("reads state stored as a JSON string and ignores approval without an outline", () => {
    const stored = JSON.stringify({ fanfic: { request: { fandom: "Hades" }, outline: null, outlineApproved: true } });
    const state = readFanficState(stored);
    expect(state?.request.fandom).toBe("Hades");
    expect(state?.outlineApproved).toBe(false);
  });
});

describe("fanfic prompts", () => {
  it("puts the rating rule, the adults rule, the request, and the outline in the system prompt", () => {
    const segments = buildFanficSystemSegments({
      state: writingState({ rating: "explicit", adultsConfirmed: true }),
      castCards: "",
      worldInfo: "",
    });
    const text = segments.map((segment) => segment.content).join("\n");
    expect(text).toContain("Explicit: graphic sexual content");
    expect(text).toContain("Every character in sexual or sexualized content is an adult (18+)");
    expect(text).toContain("Relationships: Aziraphale/Crowley");
    expect(text).toContain("Chapter 2: Thaw");
    expect(text).toContain("Output only the chapter's prose");
    expect(segments.map((segment) => segment.displayName)).not.toContain("Canon Reference");
  });

  it("keeps sexual content out of general and teen fics", () => {
    const text = buildFanficSystemSegments({ state: writingState({ rating: "general" }), castCards: "", worldInfo: "" })
      .map((segment) => segment.content)
      .join("\n");
    expect(text).toContain("General Audiences: no sexual content");
    expect(text).toContain("Never sexualize a minor.");
  });

  it("guides each chapter from the outline and marks the last planned one", () => {
    const state = writingState();
    expect(buildFanficChapterGuide(state, 1)).toContain("Chapter 1: First Flakes");
    expect(buildFanficChapterGuide(state, 1)).not.toContain("final planned chapter");
    expect(buildFanficChapterGuide(state, 2, "More banter.")).toContain("final planned chapter");
    expect(buildFanficChapterGuide(state, 2, "More banter.")).toContain(
      "Requester's notes for this chapter:\nMore banter.",
    );
    expect(buildFanficChapterGuide(state, 3)).toContain("goes past the outline");
  });

  it("sends the previous draft and the notes for a rewrite", () => {
    const guide = buildFanficRevisionGuide(writingState(), 1, "Snarkier Crowley.", "Old draft text.");
    expect(guide).toContain("Requester's notes:\nSnarkier Crowley.");
    expect(guide).toContain('Previous draft:\n"""\nOld draft text.\n"""');
  });

  it("pairs each written chapter with its request and strips headings the model added", () => {
    const labeled = labelFanficChapterHistory(
      [
        { id: "m1", role: "assistant", content: "## Chapter 1: First Flakes\n\nSnow fell." },
        { id: "m2", role: "assistant", content: "They talked." },
      ],
      writingState().outline,
    );
    expect(labeled.map((message) => [message.role, message.content])).toEqual([
      ["user", "Write chapter 1: First Flakes."],
      ["assistant", "Snow fell."],
      ["user", "Write chapter 2: Thaw."],
      ["assistant", "They talked."],
    ]);
    expect(stripFanficChapterHeading("Chapter 3 - Thaw\n\nBody")).toBe("Body");
    expect(stripFanficChapterHeading("“Chapter one,” he read aloud.")).toBe("“Chapter one,” he read aloud.");
  });

  it("renders library cards as canon reference without roleplay placeholders", () => {
    const cards = renderFanficCastCards([
      { name: "Crowley", description: "{{char}} teases {{user}}.", personality: "", mesExample: "" },
    ]);
    expect(cards).toBe("### Crowley\nDescription: Crowley teases another character.");
  });

  it("numbers chapters from assistant messages only", () => {
    expect(
      fanficChapterRefs([
        { id: "a", role: "assistant", content: "One" },
        { id: "u", role: "user", content: "ignored" },
        { id: "b", role: "assistant", content: "Two" },
      ]).map((chapter) => [chapter.number, chapter.messageId]),
    ).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });
});

describe("fanfic outline parsing", () => {
  it("reads fenced JSON after a thinking block", () => {
    const outline = parseFanficOutlineReply(
      '<think>plan it</think>\nHere you go:\n```json\n{"title":"Snow Day","summary":"S","chapters":[{"title":"A","summary":"a"},{"title":"B","beats":"b"}]}\n```',
    );
    expect(outline.title).toBe("Snow Day");
    expect(outline.chapters).toEqual([
      { number: 1, title: "A", summary: "a" },
      { number: 2, title: "B", summary: "b" },
    ]);
  });

  it("throws when the reply has no chapters", () => {
    expect(() => parseFanficOutlineReply("Sorry, I can't plan that.")).toThrow(FanficOutlineParseError);
  });

  it("reads the plan past the predictable version and doesn't keep that version", () => {
    const outline = parseFanficOutlineReply(
      '{"predictable":"Holmes finds a tunnel to the bank, like {The Red-Headed League}.","title":"Clocks","summary":"S","chapters":[{"title":"A","summary":"a"}]}',
    );
    expect(outline).toEqual({ title: "Clocks", summary: "S", chapters: [{ number: 1, title: "A", summary: "a" }] });
  });
});

describe("fanfic outline prompt", () => {
  it("asks the planner to name the predictable version first and plot past it", () => {
    const [system, user] = buildFanficOutlineMessages({
      request: { ...defaultFanficRequest(), fandom: "Sherlock Holmes", chapterCount: 4 },
      castCards: "",
    });
    expect(system!.content).toContain(FANFIC_OUTLINE_PLOT_RULES);
    expect(user!.content).toContain('{"predictable": string, "title": string');
    expect(user!.content).toContain("exactly 4 chapters");
  });
});

describe("fanfic export", () => {
  it("escapes prose and tags in HTML and keeps AO3-style headers", () => {
    const file = buildFanficHtml({
      state: writingState({ tags: ["<script>"] }),
      chapters: ["He said *hi* & <left>.", "Second."],
    });
    expect(file.filename).toBe("snow-day.html");
    expect(file.content).toContain("<dd>&lt;script&gt;, Third person limited</dd>");
    expect(file.content).toContain("<p>He said <em>hi</em> &amp; &lt;left&gt;.</p>");
    expect(file.content).toContain("<h2>Chapter 2: Thaw</h2>");
    expect(file.content).not.toContain("<script>");
  });

  it("writes markdown chapters with headings and progress", () => {
    const file = buildFanficMarkdown({ state: writingState(), chapters: ["## Chapter 1\n\nSnow fell."] });
    expect(file.content).toContain("**Chapters:** 1/2");
    expect(file.content).toContain("## Chapter 1: First Flakes\n\nSnow fell.");
  });
});

describe("fanfic agents", () => {
  it("never enables built-in or custom agents in fanfic chats", () => {
    const metadata = { enableAgents: true, activeAgentIds: ["world-state", "custom-agent-1"] };
    expect(enabledChatAgentIds(metadata, "fanfic")).toEqual([]);
    expect(isBuiltInAgentAvailableInChatMode("fanfic", "world-state")).toBe(false);
    expect([...filterAgentIdsForChatMode(["world-state", "custom-agent-1"], "fanfic")]).toEqual([]);
    expect(enabledChatAgentIds(metadata, "roleplay")).toContain("world-state");
  });
});

describe("fanfic memory recall", () => {
  it("stays off even when stale metadata asks for it or carries an active scene", () => {
    expect(getEffectiveMemoryRecallEnabled("fanfic", { enableMemoryRecall: true, sceneStatus: "active" })).toBe(false);
    expect(getEffectiveMemoryRecallEnabled("roleplay", {})).toBe(true);
  });
});

describe("fanfic outline approval", () => {
  const pending = (): FanficState => ({ ...writingState(), outlineApproved: false });

  it("stores the normalized edit as approved when every requested chapter is there", () => {
    const outline = pending().outline!;
    const approved = approveFanficOutline(pending(), {
      ...outline,
      chapters: outline.chapters.map((chapter) => ({ ...chapter, title: `  ${chapter.title}  ` })),
    });
    expect(approved.outlineApproved).toBe(true);
    expect(approved.outline?.chapters.map((chapter) => chapter.title)).toEqual(["First Flakes", "Thaw"]);
  });

  it("rejects a blanked chapter or an extra one instead of saving a different count", () => {
    const outline = pending().outline!;
    expect(() =>
      approveFanficOutline(pending(), {
        ...outline,
        chapters: [outline.chapters[0]!, { number: 2, title: " ", summary: "" }],
      }),
    ).toThrow(FanficOutlineCountError);
    expect(() =>
      approveFanficOutline(pending(), {
        ...outline,
        chapters: [...outline.chapters, { number: 3, title: "Extra", summary: "x" }],
      }),
    ).toThrow(FanficOutlineCountError);
  });
});
