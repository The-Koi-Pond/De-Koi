import type { StreamEvent } from "../../../../engine/contracts/types/chat";
import type { FanficVersionOriginKind } from "../../../../engine/contracts/types/fanfic";
import { parseRecord, readString } from "../../../../engine/generation/runtime-records";
import { readFanficVersion } from "../../../../engine/modes/fanfic/versions";

/** A chapter that just became finished (written, continued, reset or kept as is) and the write that made it. */
export interface FanficFinishedChapter {
  messageId: string;
  /** Null when the version record can't be read. */
  origin: FanficVersionOriginKind | null;
}

/**
 * Passes a chapter write's events through and remembers the chapter it saved when that ended finished, so the
 * follow-ups that read a finished chapter (ledger, phrase bans, plan) can skip one kept unfinished.
 */
export function trackFanficWriteFinished(events: AsyncGenerator<StreamEvent>): {
  events: AsyncGenerator<StreamEvent>;
  finished: () => FanficFinishedChapter | null;
} {
  let finished: FanficFinishedChapter | null = null;
  async function* tracked(): AsyncGenerator<StreamEvent> {
    for await (const event of events) {
      if (event.type === "assistant_message") {
        const data = parseRecord(event.data);
        const version = readFanficVersion(data.extra);
        finished = version?.unfinished
          ? null
          : { messageId: readString(data.id), origin: version ? (version.origin?.kind ?? null) : "chapter" };
      }
      yield event;
    }
  }
  return { events: tracked(), finished: () => finished };
}

/**
 * What runs once a chapter is finished, whichever way it got there, besides the ledger update every chapter gets: the
 * phrase bans for that chapter, and for a chapter written as a new chapter a re-plan of the rest, as after any new one.
 */
export function fanficFollowUps(chapter: FanficFinishedChapter): { phraseBansFor: string; proposePlan: boolean } {
  return { phraseBansFor: chapter.messageId, proposePlan: chapter.origin === "chapter" };
}
