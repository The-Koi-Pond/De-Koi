/** Who wrote a world-tick event: the proposing model or the user. */
export type WorldTickEventSource = "model" | "user";

/**
 * Review state of one off-screen event. Only "accepted" events are ever written into the chat;
 * "deferred" events are offered again on the next tick; "rejected" events are dropped.
 */
export type WorldTickEventStatus = "proposed" | "accepted" | "rejected" | "deferred";

/**
 * What started a tick: the user's own request, or an offer the app made at a clear story boundary
 * (a formal scene ended, or the user's message jumped ahead in time). Offers are never applied on
 * their own; the user still reviews every event.
 */
export type WorldTickTrigger = "manual" | "scene_concluded" | "time_skip";

/** An offer to let time pass, made at a story boundary. It costs nothing until the user takes it. */
export interface WorldTickOffer {
  /** The boundary this offer is for; one boundary is only ever offered once. */
  id: string;
  trigger: Exclude<WorldTickTrigger, "manual">;
  /** Suggested amount of time, from the user's own words when there were any. May be empty. */
  elapsed: string;
  /** What happened, in a few words: the scene's name, or the time-skip phrase. */
  label: string;
  createdAt: string;
}

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
  /** The offered boundary this tick answers, or null for a manual tick. */
  boundaryKey: string | null;
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
  boundaryKey: string | null;
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
  /** Per-chat switch for offers at scene ends and time skips. The manual button always works. */
  offersEnabled: boolean;
  /** The offer waiting for the user, if any. */
  offer: WorldTickOffer | null;
  /** Boundaries already offered (taken, dismissed or replaced), newest last, bounded. */
  offeredBoundaries: string[];
  updatedAt: string;
}

export type WorldTickCommand =
  | { type: "set_event_status"; eventId: string; status: Exclude<WorldTickEventStatus, "proposed"> }
  | { type: "edit_event"; eventId: string; text: string }
  | { type: "add_event"; text: string }
  | { type: "set_elapsed"; elapsed: string }
  | { type: "discard_pending" }
  | { type: "dismiss_offer"; offerId: string }
  | { type: "set_offers_enabled"; enabled: boolean };
