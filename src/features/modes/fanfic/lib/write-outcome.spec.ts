import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../../../engine/contracts/types/chat";
import type { FanficVersionOriginKind } from "../../../../engine/contracts/types/fanfic";
import { fanficFollowUps, trackFanficWriteFinished, type FanficFinishedChapter } from "./write-outcome";

async function* events(...items: StreamEvent[]): AsyncGenerator<StreamEvent> {
  yield* items;
}

const saved = (unfinished: unknown, kind: FanficVersionOriginKind = "chapter"): StreamEvent => ({
  type: "assistant_message",
  data: {
    id: "message-1",
    extra: { fanficVersion: { models: [], origin: { kind, notes: "" }, unfinished } },
  },
});

async function finishedAfter(
  ...items: StreamEvent[]
): Promise<{ finished: FanficFinishedChapter | null; passed: StreamEvent[] }> {
  const tracked = trackFanficWriteFinished(events(...items));
  const passed: StreamEvent[] = [];
  for await (const event of tracked.events) passed.push(event);
  return { finished: tracked.finished(), passed };
}

describe("trackFanficWriteFinished", () => {
  it("reports the chapter a write saved finished, with the kind of write that made it", async () => {
    const token: StreamEvent = { type: "token", data: "Snow." };
    const result = await finishedAfter(token, saved(null, "revise"));

    expect(result.finished).toEqual({ messageId: "message-1", origin: "revise" });
    expect(result.passed).toEqual([token, saved(null, "revise")]);
  });

  it("reports a write whose chapter was kept unfinished as not finished", async () => {
    const result = await finishedAfter(
      saved({ reason: "provider_reset", code: "llm_stream_text_reset", message: null }),
    );

    expect(result.finished).toBeNull();
  });

  it("reports a finished chapter whose origin can't be read with no origin", async () => {
    const saved: StreamEvent = {
      type: "assistant_message",
      data: { id: "message-1", extra: { fanficVersion: { models: [], origin: { kind: "sequel" }, unfinished: null } } },
    };

    expect((await finishedAfter(saved)).finished).toEqual({ messageId: "message-1", origin: null });
  });

  it("reports a write that saved no chapter as not finished", async () => {
    expect((await finishedAfter({ type: "token", data: "Snow." })).finished).toBeNull();
  });
});

describe("fanficFollowUps", () => {
  const plain = { polish: false, polishNext: false };
  const settled = (proposePlan: boolean) => ({ phraseBansFor: "m3", updateLedger: true, proposePlan });

  it("cleans banned phrases from the chapter and re-plans after a chapter written as a new chapter", () => {
    expect(fanficFollowUps({ messageId: "m3", origin: "chapter" }, plain)).toEqual(settled(true));
  });

  it.each(["regenerate", "revise", "extra"] as const)(
    "cleans banned phrases from the chapter without re-planning after a %s",
    (origin) => {
      expect(fanficFollowUps({ messageId: "m3", origin }, plain)).toEqual(settled(false));
    },
  );

  it("cleans banned phrases without re-planning when the version record can't be read", () => {
    expect(fanficFollowUps({ messageId: "m3", origin: null }, plain)).toEqual(settled(false));
  });

  it("re-plans right away but leaves bans and the ledger for the polished text while a polish comes next", () => {
    expect(fanficFollowUps({ messageId: "m3", origin: "chapter" }, { polish: false, polishNext: true })).toEqual({
      phraseBansFor: null,
      updateLedger: false,
      proposePlan: true,
    });
  });

  it("after the polish, cleans bans and updates the ledger without a second re-plan", () => {
    // A polish that changed nothing still shows the version written as a new chapter.
    expect(fanficFollowUps({ messageId: "m3", origin: "chapter" }, { polish: true, polishNext: false })).toEqual(
      settled(false),
    );
  });
});
