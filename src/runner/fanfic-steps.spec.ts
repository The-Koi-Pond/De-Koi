import { describe, expect, it } from "vitest";
import { FanficStepQueue, fanficStepsAfterJob } from "./fanfic-steps";
import type { RunnerEvent } from "./jobs";

const finished = (id = "m1", kind = "chapter", unfinished: unknown = null): RunnerEvent[] => [
  { type: "token", data: "Snow." },
  {
    type: "assistant_message",
    data: { id, extra: { fanficVersion: { models: [], origin: { kind, notes: "" }, unfinished } } },
  },
];

const write = (fanficKind: string, extra: Record<string, unknown> = {}) => ({ chatId: "chat-1", fanficKind, ...extra });

describe("which after-chapter steps the runner takes for a write", () => {
  it("updates the ledger and re-plans after a new chapter with nothing chained", () => {
    expect(fanficStepsAfterJob(write("chapter"), finished(), null)).toEqual({
      chatId: "chat-1",
      updateLedger: true,
      proposePlan: true,
    });
  });

  it("re-plans now but leaves the ledger for the polished text when the polish comes next", () => {
    const next = write("polish", { regenerateMessageId: "m1" });
    expect(fanficStepsAfterJob(write("chapter"), finished(), next)).toEqual({
      chatId: "chat-1",
      updateLedger: false,
      proposePlan: true,
    });
  });

  it("updates the ledger after the polish, without a second re-plan", () => {
    expect(fanficStepsAfterJob(write("polish"), finished(), null)).toEqual({
      chatId: "chat-1",
      updateLedger: true,
      proposePlan: false,
    });
  });

  it("takes nothing in a write-all run while the chapter's polish comes next", () => {
    const run = { fanficBatch: true };
    expect(fanficStepsAfterJob(write("chapter", run), finished(), write("polish", run))).toBeNull();
  });

  it("updates the ledger after a write-all chapter without re-planning", () => {
    const run = { fanficBatch: true };
    expect(fanficStepsAfterJob(write("chapter", run), finished(), write("chapter", run))).toEqual({
      chatId: "chat-1",
      updateLedger: true,
      proposePlan: false,
    });
  });

  it("takes nothing for a cut-off chapter, a write that saved none, or a chat reply", () => {
    expect(fanficStepsAfterJob(write("chapter"), finished("m1", "chapter", { reason: "length" }), null)).toBeNull();
    expect(fanficStepsAfterJob(write("chapter"), [{ type: "done" }], null)).toBeNull();
    expect(fanficStepsAfterJob({ chatId: "chat-1" }, finished(), null)).toBeNull();
  });
});

describe("running a fic's steps", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
  };

  it("runs one fic's steps in the order its writes ended, never two at once", async () => {
    const calls: string[] = [];
    const first = deferred();
    const queue = new FanficStepQueue({
      updateLedger: async (chatId) => {
        calls.push(`ledger ${chatId} start`);
        if (calls.length === 1) await first.promise;
        calls.push(`ledger ${chatId} end`);
      },
      proposePlan: async (chatId) => {
        calls.push(`plan ${chatId}`);
      },
    });

    const one = queue.run({ chatId: "chat-1", updateLedger: true, proposePlan: true });
    const two = queue.run({ chatId: "chat-1", updateLedger: true, proposePlan: false });
    await Promise.resolve();
    expect(calls).toEqual(["ledger chat-1 start"]);
    first.resolve();
    await Promise.all([one, two]);

    expect(calls).toEqual([
      "ledger chat-1 start",
      "ledger chat-1 end",
      "plan chat-1",
      "ledger chat-1 start",
      "ledger chat-1 end",
    ]);
  });

  it("logs a failed step and still runs the next one", async () => {
    const logged: string[] = [];
    const ran: string[] = [];
    const queue = new FanficStepQueue(
      {
        updateLedger: async () => {
          throw new Error("provider down");
        },
        proposePlan: async (chatId) => {
          ran.push(chatId);
        },
      },
      (message, error) => logged.push(`${message}: ${(error as Error).message}`),
    );

    await queue.run({ chatId: "chat-1", updateLedger: true, proposePlan: true });

    expect(logged).toEqual(["story ledger of chat chat-1 not updated: provider down"]);
    expect(ran).toEqual(["chat-1"]);
  });
});
