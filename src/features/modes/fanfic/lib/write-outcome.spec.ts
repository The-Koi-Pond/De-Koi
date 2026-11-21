import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../../../engine/contracts/types/chat";
import type { FanficVersionOriginKind } from "../../../../engine/contracts/types/fanfic";
import { FANFIC_STEPS_ON_SERVER_EVENT } from "../../../../engine/modes/fanfic/batch";
import { trackFanficWriteFinished, type FanficWrittenChapter } from "./write-outcome";

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

const stepsOnServer = { type: FANFIC_STEPS_ON_SERVER_EVENT } as unknown as StreamEvent;

async function finishedAfter(
  ...items: StreamEvent[]
): Promise<{ finished: FanficWrittenChapter | null; passed: StreamEvent[] }> {
  const tracked = trackFanficWriteFinished(events(...items));
  const passed: StreamEvent[] = [];
  for await (const event of tracked.events) passed.push(event);
  return { finished: tracked.finished(), passed };
}

describe("trackFanficWriteFinished", () => {
  it("reports the chapter a write saved finished, with the kind of write that made it", async () => {
    const token: StreamEvent = { type: "token", data: "Snow." };
    const result = await finishedAfter(token, saved(null, "revise"));

    expect(result.finished).toEqual({ messageId: "message-1", origin: "revise", stepsOnServer: false });
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

    expect((await finishedAfter(saved)).finished).toEqual({
      messageId: "message-1",
      origin: null,
      stepsOnServer: false,
    });
  });

  it("reports a write that saved no chapter as not finished", async () => {
    expect((await finishedAfter({ type: "token", data: "Snow." })).finished).toBeNull();
  });

  it("notes when the runner took the after-chapter steps, and keeps its event off the screen", async () => {
    // A screen that caught up on the job after its connection came back replays the runner's event too.
    const result = await finishedAfter(saved(null), stepsOnServer);

    expect(result.finished).toEqual({ messageId: "message-1", origin: "chapter", stepsOnServer: true });
    expect(result.passed).toEqual([saved(null)]);
  });
});
