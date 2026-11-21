import type { StreamEvent } from "../../../../engine/contracts/types/chat";
import { parseRecord, readString } from "../../../../engine/generation/runtime-records";
import { FANFIC_STEPS_ON_SERVER_EVENT, type FanficFinishedChapter } from "../../../../engine/modes/fanfic/batch";
import { readFanficVersion } from "../../../../engine/modes/fanfic/versions";

/** A chapter a write finished, as the reader saw the write. */
export interface FanficWrittenChapter extends FanficFinishedChapter {
  /** The hosted runner runs this write's ledger update and re-plan (no screen was following when it ended). */
  stepsOnServer: boolean;
}

/**
 * Passes a chapter write's events through and remembers the chapter it saved when that ended finished, so the
 * follow-ups that read a finished chapter (ledger, phrase bans, plan) can skip one kept unfinished.
 */
export function trackFanficWriteFinished(events: AsyncGenerator<StreamEvent>): {
  events: AsyncGenerator<StreamEvent>;
  finished: () => FanficWrittenChapter | null;
} {
  let finished: FanficFinishedChapter | null = null;
  let stepsOnServer = false;
  async function* tracked(): AsyncGenerator<StreamEvent> {
    for await (const event of events) {
      // The runner's own event, not a generation event: the screen has nothing to show for it.
      if ((event.type as string) === FANFIC_STEPS_ON_SERVER_EVENT) {
        stepsOnServer = true;
        continue;
      }
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
  return { events: tracked(), finished: () => (finished ? { ...finished, stepsOnServer } : null) };
}
