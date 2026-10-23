/** Who wrote a world-tick event: the proposing model or the user. */
export type WorldTickEventSource = "model" | "user";

/**
 * Review state of one off-screen event. Only "accepted" events are ever written into the chat;
 * "deferred" events are offered again on the next tick; "rejected" events are dropped.
 */
export type WorldTickEventStatus = "proposed" | "accepted" | "rejected" | "deferred";

/** What started a tick. The first slice only supports the user's explicit request. */
type WorldTickTrigger = "manual";

export interface WorldTickEvent {
  id: string;
  text: string;
  status: WorldTickEventStatus;
  source: WorldTickEventSource;
  /** True once the user changed the wording of a model event. */
  edited: boolean;
  /** Names of the characters the event involves, as the proposer gave them. */
  characters: string[];
  /** True when the event was deferred on an earlier tick and offered again; discarding keeps it. */
  carried: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A tick waiting for review. Nothing in it reaches prompts until it is applied. */
export interface PendingWorldTick {
  id: string;
  trigger: WorldTickTrigger;
  /** How much time passes, in the user's own words ("three days", "until nightfall"). */
  elapsed: string;
  /** Optional steer the user gave the proposer. */
  guidance: string;
  /** The newest visible message when the tick was proposed; a newer message makes the tick stale. */
  anchorMessageId: string | null;
  events: WorldTickEvent[];
  createdAt: string;
  updatedAt: string;
}

/** An applied tick, kept as a short timeline with provenance for the narrator message it wrote. */
export interface AppliedWorldTick {
  id: string;
  trigger: WorldTickTrigger;
  elapsed: string;
  /** The narrator message that carries the accepted events into the chat. */
  messageId: string;
  /** Accepted events only. Rejected and deferred events are never stored here. */
  events: Array<Pick<WorldTickEvent, "id" | "text" | "source" | "edited" | "characters">>;
  appliedAt: string;
}

export interface RoleplayWorldTickState {
  version: 1;
  /** Bumped on every change, so a stale editor cannot overwrite a newer review. */
  revision: number;
  pending: PendingWorldTick | null;
  /** Deferred events carried into the next proposal. */
  deferred: WorldTickEvent[];
  /** Newest last, bounded. */
  timeline: AppliedWorldTick[];
  updatedAt: string;
}

export type WorldTickCommand =
  | { type: "set_event_status"; eventId: string; status: Exclude<WorldTickEventStatus, "proposed"> }
  | { type: "edit_event"; eventId: string; text: string }
  | { type: "add_event"; text: string }
  | { type: "set_elapsed"; elapsed: string }
  | { type: "discard_pending" };
