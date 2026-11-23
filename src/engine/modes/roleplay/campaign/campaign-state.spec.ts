import { describe, expect, it } from "vitest";

import type { CampaignProgress, RoleplayCampaignState } from "../../../contracts/types/roleplay-campaign";
import { buildCampaignContext } from "./campaign-context";
import type { CampaignTick } from "./campaign-schemas";
import {
  applyTick,
  currentProgress,
  readCampaign,
  replyKey,
  START_KEY,
  unreadExchange,
  withProgress,
} from "./campaign-state";

const NOW = "2026-11-20T12:00:00.000Z";

function start(): CampaignProgress {
  return {
    key: START_KEY,
    situationId: "arrival",
    clock: 0,
    replies: 0,
    outcomes: [],
    facts: [],
    debts: [],
    revealedClueIds: [],
    stances: {},
    ladder: {},
    pacing: "hold",
    endingId: null,
    turn: 0,
  };
}

function campaign(overrides: Partial<RoleplayCampaignState> = {}): RoleplayCampaignState {
  return {
    version: 1,
    status: "playing",
    request: {
      ask: "a lighthouse mystery",
      focus: "story",
      secondaryFocus: null,
      heat: "none",
      limits: ["no harm to animals"],
      length: "short",
      blind: true,
    },
    plan: {
      title: "The Last Lamp",
      pitch: "A keeper is missing.",
      truth: "The keeper staged it.",
      keyTruths: [{ id: "staged", text: "The keeper staged it." }],
      tableRules: "Consequences stick.",
      cast: [
        {
          id: "ivo",
          name: "Ivo",
          role: "the keeper's son",
          want: "his father back",
          fear: "the sea",
          secret: "he helped",
          towardPlayer: "wary",
          ladder: [
            { looksLike: "short answers", opensNext: "the player keeps a promise" },
            { looksLike: "jokes", opensNext: "the player shares a secret" },
            { looksLike: "trust", opensNext: "nothing" },
          ],
        },
      ],
      clues: [
        { id: "boots", text: "Dry boots by the door.", truthId: "staged" },
        { id: "letter", text: "A half-burned letter.", truthId: "staged" },
      ],
      endings: [
        { id: "found", condition: "The keeper is found", tone: "bittersweet" },
        { id: "gone", condition: "The keeper is never found", tone: "grim" },
      ],
      situations: [
        {
          id: "arrival",
          act: 1,
          title: "Arrival",
          happening: "The lamp is dark.",
          question: "Climb the tower or question the son?",
          present: ["ivo"],
          pressure: ["A storm rolls in.", "The boat drifts off."],
          clueIds: ["boots"],
          holds: ["Ivo helped"],
          exits: [
            { id: "climb", text: "Climb the tower", consequence: "Ivo is left alone", leadsTo: "tower" },
            { id: "question", text: "Question Ivo", consequence: "The lamp stays dark", leadsTo: null },
          ],
        },
        {
          id: "cellar",
          act: 1,
          title: "Cellar",
          happening: "Water on the floor.",
          question: "Open the trunk?",
          present: [],
          pressure: ["The tide rises."],
          clueIds: ["letter"],
          holds: [],
          exits: [{ id: "open", text: "Open it", consequence: "Wet papers", leadsTo: null }],
        },
        {
          id: "tower",
          act: 2,
          title: "Tower",
          happening: "Wind at the top.",
          question: "Light the lamp?",
          present: ["ivo"],
          pressure: ["A ship nears the rocks.", "The ship hits."],
          clueIds: [],
          holds: [],
          exits: [{ id: "light", text: "Light it", consequence: "Saved ship", leadsTo: null }],
        },
      ],
      revision: 0,
    },
    progress: [start()],
    lastReplanTurn: 0,
    narratorCharacterId: null,
    lorebookId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function tick(overrides: Partial<CampaignTick> = {}): CampaignTick {
  return {
    situation: "ongoing",
    exitId: null,
    outcome: "",
    clockAdvanced: false,
    newFacts: [],
    revealedClueIds: [],
    debtsCreated: [],
    debtsPaidIds: [],
    stances: [],
    ladder: [],
    pacing: "hold",
    endingId: null,
    replan: false,
    replanWhy: "",
    ...overrides,
  };
}

const opening = { id: "m0", role: "assistant", content: "The lamp is dark." };
const user1 = { id: "m1", role: "user", content: "I look around the room carefully for anything odd." };
const reply1 = { id: "m2", role: "assistant", content: "You find dry boots." };

function ctx(key: string, lengths: number[] = [80]) {
  return { key, recentUserLengths: lengths, now: NOW };
}

describe("campaign state", () => {
  it("reads only a complete stored campaign", () => {
    expect(readCampaign({ roleplayCampaign: campaign() })?.plan.title).toBe("The Last Lamp");
    expect(readCampaign({ roleplayCampaign: { version: 1 } })).toBeNull();
    expect(readCampaign({})).toBeNull();
  });

  it("rolls back to the snapshot before a regenerated or edited reply", () => {
    const state0 = campaign();
    const after1 = applyTick(state0, state0.progress[0]!, tick({ revealedClueIds: ["boots"] }), ctx(replyKey(reply1)));
    const state1 = withProgress(state0, state0.progress[0]!, after1, NOW);

    expect(currentProgress(state1, [opening, user1, reply1]).revealedClueIds).toEqual(["boots"]);
    // A swipe of reply1 has different text: the boots were never found in it.
    const swiped = { ...reply1, content: "Nothing but dust." };
    expect(currentProgress(state1, [opening, user1, swiped]).key).toBe(START_KEY);
    // Regenerating reply1 builds on the history before it.
    expect(currentProgress(state1, [opening, user1]).key).toBe(START_KEY);
  });

  it("reads only what came after the last processed reply, and nothing before the player speaks", () => {
    const state0 = campaign();
    expect(unreadExchange(state0, [opening]).turns).toEqual([]);
    expect(unreadExchange(state0, [opening, user1, reply1]).turns.map((m) => m.id)).toEqual(["m1", "m2"]);
    const after1 = applyTick(state0, state0.progress[0]!, tick(), ctx(replyKey(reply1)));
    const state1 = withProgress(state0, state0.progress[0]!, after1, NOW);
    expect(unreadExchange(state1, [opening, user1, reply1]).turns).toEqual([]);
  });

  it("follows the chosen exit, records the outcome and asks the next reply to turn", () => {
    const state = campaign();
    const next = applyTick(state, state.progress[0]!, tick({ situation: "resolved", exitId: "climb" }), ctx("k"));
    expect(next.situationId).toBe("tower");
    expect(next.outcomes).toEqual([{ situationId: "arrival", text: "Climb the tower" }]);
    expect(next.pacing).toBe("turn");
    expect(next.clock).toBe(0);
  });

  it("goes to the next unplayed situation when the exit names none", () => {
    const state = campaign();
    const next = applyTick(state, state.progress[0]!, tick({ situation: "resolved", exitId: "question" }), ctx("k"));
    expect(next.situationId).toBe("cellar");
  });

  it("resolves the situation when its clock runs out", () => {
    const state = campaign();
    const ticking = { ...state.progress[0]!, clock: 1 };
    const next = applyTick(state, ticking, tick({ clockAdvanced: true }), ctx("k"));
    expect(next.outcomes[0]?.text).toContain("The boat drifts off.");
    expect(next.situationId).toBe("cellar");
    expect(next.pacing).toBe("turn");
  });

  it("brings the pressure in when the story sits still or the player is passive", () => {
    const state = campaign();
    const still = { ...state.progress[0]!, replies: 3 };
    expect(applyTick(state, still, tick(), ctx("k")).pacing).toBe("press");
    expect(applyTick(state, state.progress[0]!, tick(), ctx("k", [10, 12, 8])).pacing).toBe("press");
    expect(applyTick(state, state.progress[0]!, tick(), ctx("k", [10, 200, 8])).pacing).toBe("hold");
  });

  it("lets a lingering moment pass unless the player is enjoying it there", () => {
    const state = campaign();
    const lingering = { ...state.progress[0]!, replies: 4 };
    const moved = applyTick(state, lingering, tick({ pacing: "press" }), ctx("k"));
    expect(moved.situationId).toBe("cellar");
    expect(moved.outcomes[0]?.text).toBe("The moment passed before it was settled.");
    expect(applyTick(state, lingering, tick({ pacing: "hold" }), ctx("k")).situationId).toBe("arrival");
    expect(applyTick(state, lingering, tick({ pacing: "hold" }), ctx("k", [5, 9, 7])).situationId).toBe("cellar");
  });

  it("does not turn without a resolution, and drops ids the plan does not have", () => {
    const state = campaign();
    const next = applyTick(
      state,
      state.progress[0]!,
      tick({ pacing: "turn", revealedClueIds: ["boots", "made-up"], stances: [{ castId: "nobody", text: "x" }] }),
      ctx("k"),
    );
    expect(next.pacing).toBe("press");
    expect(next.revealedClueIds).toEqual(["boots"]);
    expect(next.stances).toEqual({});
  });

  it("moves closeness one stage at a time", () => {
    const state = campaign();
    const next = applyTick(state, state.progress[0]!, tick({ ladder: [{ castId: "ivo", stage: 2 }] }), ctx("k"));
    expect(next.ladder).toEqual({ ivo: 1 });
  });

  it("lands an ending when nothing is left, and ends after the landing reply", () => {
    const state = campaign();
    const last = {
      ...state.progress[0]!,
      situationId: "tower",
      outcomes: [
        { situationId: "arrival", text: "a" },
        { situationId: "cellar", text: "b" },
      ],
    };
    const landing = applyTick(state, last, tick({ situation: "resolved", exitId: "light" }), ctx("k1"));
    expect(landing.pacing).toBe("land");
    expect(landing.endingId).toBe("found");
    const withLanding = withProgress(state, state.progress[0]!, landing, NOW);
    const after = applyTick(withLanding, landing, tick(), ctx("k2"));
    expect(withProgress(withLanding, landing, after, NOW).status).toBe("ended");
  });

  it("keeps start plus the newest snapshots and drops ones from replaced replies", () => {
    let state = campaign();
    let from = state.progress[0]!;
    for (let index = 1; index <= 12; index += 1) {
      const next = applyTick(state, from, tick(), ctx(`k${index}`));
      state = withProgress(state, from, next, NOW);
      from = next;
    }
    expect(state.progress[0]!.key).toBe(START_KEY);
    expect(state.progress).toHaveLength(9);
    expect(state.progress.at(-1)!.key).toBe("k12");
    // Branching off an older snapshot drops everything after it.
    const older = state.progress[3]!;
    const branch = applyTick(state, older, tick(), ctx("branch"));
    const branched = withProgress(state, older, branch, NOW);
    expect(branched.progress.map((snapshot) => snapshot.key).slice(-2)).toEqual([older.key, "branch"]);
  });
});

describe("campaign prompt block", () => {
  it("shows the current situation and never the truth, secrets or later situations", () => {
    const state = campaign();
    const context = buildCampaignContext({
      chatId: "c1",
      chatMode: "roleplay",
      metadata: { roleplayCampaign: state },
      messages: [opening],
    });
    expect(context?.block).toContain("The lamp is dark.");
    expect(context?.block).toContain("Dry boots by the door.");
    expect(context?.block).toContain("Never: no harm to animals.");
    expect(context?.block).not.toContain("The keeper staged it.");
    expect(context?.block).not.toContain("he helped");
    expect(context?.block).not.toContain("Wind at the top.");
    expect(context?.attributionItems[0]?.snippet).toBeNull();
  });

  it("keeps every reply small, and grounds a lost or returning player first", () => {
    const metadata = { roleplayCampaign: campaign() };
    const reply = { ...opening, createdAt: "2026-01-01T10:00:00.000Z" };
    const block = (latestUserInput: string, hoursLater: number) =>
      buildCampaignContext({
        chatId: "c1",
        chatMode: "roleplay",
        metadata,
        messages: [reply],
        latestUserInput,
        nowMs: Date.parse(reply.createdAt) + hoursLater * 3_600_000,
      })!.block;

    const plain = block("I climb to the lamp room.", 0.1);
    expect(plain).toContain("one beat per reply");
    expect(plain).not.toContain("sounds lost");
    expect(plain).not.toContain("coming back after a break");

    for (const lost of [
      "(ooc: sorry, I'm confused)",
      "wait, who is that?",
      "What should I do now?",
      "I'm so overwhelmed rn",
    ]) {
      expect(block(lost, 0.1)).toContain("sounds lost");
    }
    expect(block("I lost my footing on the stair.", 0.1)).not.toContain("sounds lost");

    expect(block("I climb to the lamp room.", 20)).toContain("coming back after a break of about 20 hours");
    expect(block("I climb to the lamp room.", 72)).toContain("about 3 days");
  });

  it("adds nothing outside Roleplay or once the campaign has ended", () => {
    const metadata = { roleplayCampaign: campaign() };
    expect(buildCampaignContext({ chatId: "c1", chatMode: "conversation", metadata, messages: [] })).toBeNull();
    const ended = { roleplayCampaign: campaign({ status: "ended" }) };
    expect(buildCampaignContext({ chatId: "c1", chatMode: "roleplay", metadata: ended, messages: [] })).toBeNull();
  });
});
