import { describe, expect, it } from "vitest";
import {
  planDekiHistoryPersistence,
  type DekiHistoryPersistenceSnapshot,
} from "./deki-history-persistence";

function snapshot(
  activeSessionId: string,
  records: DekiHistoryPersistenceSnapshot["records"],
): DekiHistoryPersistenceSnapshot {
  return { activeSessionId, records };
}

describe("planDekiHistoryPersistence", () => {
  it("updates only changed records", () => {
    const unrelated = {
      entity: "deki-sessions" as const,
      id: "session-unrelated",
      value: { id: "session-unrelated", title: "Leave me alone" },
    };
    const previous = snapshot("session-active", [
      { entity: "deki-sessions", id: "session-active", value: { id: "session-active", title: "Before" } },
      unrelated,
    ]);
    const next = snapshot("session-active", [
      { entity: "deki-sessions", id: "session-active", value: { id: "session-active", title: "After" } },
      unrelated,
    ]);

    expect(planDekiHistoryPersistence(previous, next)).toEqual({
      creates: [],
      updates: [next.records[0]],
      deletes: [],
      activeSessionChanged: false,
    });
  });

  it("creates new records and deletes removed session history", () => {
    const previous = snapshot("session-old", [
      { entity: "deki-sessions", id: "session-old", value: { id: "session-old" } },
      { entity: "deki-messages", id: "message-old", value: { id: "message-old", sessionId: "session-old" } },
    ]);
    const next = snapshot("session-new", [
      { entity: "deki-sessions", id: "session-new", value: { id: "session-new" } },
      { entity: "deki-messages", id: "message-new", value: { id: "message-new", sessionId: "session-new" } },
    ]);

    expect(planDekiHistoryPersistence(previous, next)).toEqual({
      creates: next.records,
      updates: [],
      deletes: [
        { entity: "deki-messages", id: "message-old" },
        { entity: "deki-sessions", id: "session-old" },
      ],
      activeSessionChanged: true,
    });
  });
});
