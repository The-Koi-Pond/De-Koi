import type {
  AppliedWorldTick,
  PendingWorldTick,
  RoleplayWorldTickState,
  WorldTickCommand,
  WorldTickEvent,
  WorldTickEventSource,
  WorldTickEventStatus,
  WorldTickOffer,
  WorldTickTrigger,
} from "../../../contracts/types/roleplay-world-tick";
import { createId } from "../../../core/ids";

export const WORLD_TICK_METADATA_KEY = "roleplayWorldTick";

export const WORLD_TICK_LIMITS = {
  eventCharacters: 280,
  elapsedCharacters: 80,
  guidanceCharacters: 400,
  proposedEventsPerTick: 5,
  eventsPerTick: 8,
  deferredEvents: 8,
  timelineTicks: 20,
  offerLabelCharacters: 120,
  offeredBoundaries: 50,
} as const;

export interface WorldTickStateOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
}

export class WorldTickStateError extends Error {
  constructor(
    public readonly code: "not_found" | "unreviewed_events" | "nothing_accepted" | "invalid_text" | "no_pending",
    message: string,
  ) {
    super(message);
    this.name = "WorldTickStateError";
  }
}

const EVENT_STATUSES = new Set<WorldTickEventStatus>(["proposed", "accepted", "rejected", "deferred"]);
const EVENT_SOURCES = new Set<WorldTickEventSource>(["model", "user"]);
const TRIGGERS = new Set<WorldTickTrigger>(["manual", "scene_concluded", "time_skip"]);

function trigger(value: unknown): WorldTickTrigger {
  return TRIGGERS.has(value as WorldTickTrigger) ? (value as WorldTickTrigger) : "manual";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function stringList(value: unknown, maxItems = 8, maxLength = 80): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function revision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeEvent(value: unknown, fallbackAt: string): WorldTickEvent | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, 200);
  const text = boundedText(value.text, WORLD_TICK_LIMITS.eventCharacters);
  if (!id || !text) return null;
  return {
    id,
    text,
    status: EVENT_STATUSES.has(value.status as WorldTickEventStatus)
      ? (value.status as WorldTickEventStatus)
      : "proposed",
    source: EVENT_SOURCES.has(value.source as WorldTickEventSource) ? (value.source as WorldTickEventSource) : "model",
    edited: value.edited === true,
    characters: stringList(value.characters),
    carried: value.carried === true,
    createdAt: boundedText(value.createdAt, 80) || fallbackAt,
    updatedAt: boundedText(value.updatedAt, 80) || fallbackAt,
  };
}

function normalizePending(value: unknown, fallbackAt: string): PendingWorldTick | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, 200);
  if (!id) return null;
  const events = Array.isArray(value.events)
    ? value.events
        .map((event) => normalizeEvent(event, fallbackAt))
        .filter((event): event is WorldTickEvent => !!event)
        .slice(0, WORLD_TICK_LIMITS.eventsPerTick)
    : [];
  return {
    id,
    trigger: trigger(value.trigger),
    boundaryKey: boundedText(value.boundaryKey, 200) || null,
    elapsed: boundedText(value.elapsed, WORLD_TICK_LIMITS.elapsedCharacters),
    guidance: boundedText(value.guidance, WORLD_TICK_LIMITS.guidanceCharacters),
    anchorMessageId: boundedText(value.anchorMessageId, 200) || null,
    events,
    createdAt: boundedText(value.createdAt, 80) || fallbackAt,
    updatedAt: boundedText(value.updatedAt, 80) || fallbackAt,
  };
}

function normalizeApplied(value: unknown, fallbackAt: string): AppliedWorldTick | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, 200);
  const messageId = boundedText(value.messageId, 200);
  if (!id || !messageId) return null;
  const events = Array.isArray(value.events)
    ? value.events
        .map((event) => normalizeEvent({ ...(isRecord(event) ? event : {}), status: "accepted" }, fallbackAt))
        .filter((event): event is WorldTickEvent => !!event)
        .map(({ id: eventId, text, source, edited, characters }) => ({ id: eventId, text, source, edited, characters }))
    : [];
  return {
    id,
    trigger: trigger(value.trigger),
    boundaryKey: boundedText(value.boundaryKey, 200) || null,
    elapsed: boundedText(value.elapsed, WORLD_TICK_LIMITS.elapsedCharacters),
    messageId,
    events,
    appliedAt: boundedText(value.appliedAt, 80) || fallbackAt,
  };
}

function normalizeOffer(value: unknown, fallbackAt: string): WorldTickOffer | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, 200);
  const offerTrigger = trigger(value.trigger);
  if (!id || offerTrigger === "manual") return null;
  return {
    id,
    trigger: offerTrigger,
    elapsed: boundedText(value.elapsed, WORLD_TICK_LIMITS.elapsedCharacters),
    label: boundedText(value.label, WORLD_TICK_LIMITS.offerLabelCharacters),
    createdAt: boundedText(value.createdAt, 80) || fallbackAt,
  };
}

function emptyWorldTickState(now: string): RoleplayWorldTickState {
  return {
    version: 1,
    revision: 0,
    pending: null,
    deferred: [],
    timeline: [],
    offersEnabled: true,
    offer: null,
    offeredBoundaries: [],
    updatedAt: now,
  };
}

export function normalizeWorldTickState(value: unknown, now = new Date().toISOString()): RoleplayWorldTickState {
  if (!isRecord(value)) return emptyWorldTickState(now);
  const deferred = Array.isArray(value.deferred)
    ? value.deferred
        .map((event) => normalizeEvent(event, now))
        .filter((event): event is WorldTickEvent => !!event)
        .map((event) => ({ ...event, status: "deferred" as const }))
        .slice(-WORLD_TICK_LIMITS.deferredEvents)
    : [];
  const timeline = Array.isArray(value.timeline)
    ? value.timeline
        .map((tick) => normalizeApplied(tick, now))
        .filter((tick): tick is AppliedWorldTick => !!tick)
        .slice(-WORLD_TICK_LIMITS.timelineTicks)
    : [];
  return {
    version: 1,
    revision: revision(value.revision),
    pending: normalizePending(value.pending, now),
    deferred,
    timeline,
    // Offers are on unless the user turned them off for this chat.
    offersEnabled: value.offersEnabled !== false,
    offer: value.offersEnabled === false ? null : normalizeOffer(value.offer, now),
    offeredBoundaries: stringList(value.offeredBoundaries, Number.MAX_SAFE_INTEGER, 200).slice(
      -WORLD_TICK_LIMITS.offeredBoundaries,
    ),
    updatedAt: boundedText(value.updatedAt, 80) || now,
  };
}

/** The offer waiting in a chat's stored state, if offers are on and one is waiting. */
export function readWorldTickOffer(raw: unknown): WorldTickOffer | null {
  if (!isRecord(raw) || raw.offersEnabled === false) return null;
  return normalizeOffer(raw.offer, new Date().toISOString());
}

export interface RecordWorldTickOfferInput {
  boundaryKey: string;
  trigger: WorldTickOffer["trigger"];
  elapsed: string;
  label: string;
}

export type RecordWorldTickOfferResult =
  | { offered: true; state: RoleplayWorldTickState }
  | { offered: false; reason: "offers_off" | "already_offered" | "review_open" | "invalid" };

/**
 * Records an offer for one story boundary. A boundary is offered at most once, whatever happened
 * to the offer (taken, dismissed, replaced by a newer one), so a retried send, a reload or a scene
 * callback that fires twice can never bring the same offer back. While a time skip is already
 * waiting for review nothing is offered: the user is already letting time pass.
 */
export function recordWorldTickOffer(
  state: RoleplayWorldTickState,
  input: RecordWorldTickOfferInput,
  options: WorldTickStateOptions = {},
): RecordWorldTickOfferResult {
  const now = options.now?.() ?? new Date().toISOString();
  const boundaryKey = boundedText(input.boundaryKey, 200);
  if (!boundaryKey) return { offered: false, reason: "invalid" };
  if (!state.offersEnabled) return { offered: false, reason: "offers_off" };
  if (
    state.offeredBoundaries.includes(boundaryKey) ||
    state.offer?.id === boundaryKey ||
    state.pending?.boundaryKey === boundaryKey ||
    state.timeline.some((tick) => tick.boundaryKey === boundaryKey)
  ) {
    return { offered: false, reason: "already_offered" };
  }
  if (state.pending) return { offered: false, reason: "review_open" };
  const offer: WorldTickOffer = {
    id: boundaryKey,
    trigger: input.trigger,
    elapsed: cleanWorldTickText(input.elapsed, WORLD_TICK_LIMITS.elapsedCharacters),
    label: cleanWorldTickText(input.label, WORLD_TICK_LIMITS.offerLabelCharacters),
    createdAt: now,
  };
  return {
    offered: true,
    state: bump(
      {
        ...state,
        offer,
        offeredBoundaries: [...state.offeredBoundaries, boundaryKey].slice(-WORLD_TICK_LIMITS.offeredBoundaries),
      },
      now,
    ),
  };
}

export function cleanWorldTickText(raw: string, max: number = WORLD_TICK_LIMITS.eventCharacters): string {
  return boundedText(raw, max);
}

/** Shortens an over-long model event at a sentence end, or else a word end, instead of mid-word. */
export function fitWorldTickEventText(raw: string): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  const max = WORLD_TICK_LIMITS.eventCharacters;
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentenceEnd >= max / 2) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.slice(0, max - 1).lastIndexOf(" ");
  return `${head.slice(0, wordEnd > 0 ? wordEnd : max - 1).replace(/[,;:]$/, "")}…`;
}

function bump(state: RoleplayWorldTickState, now: string): RoleplayWorldTickState {
  return { ...state, revision: state.revision + 1, updatedAt: now };
}

function requirePending(state: RoleplayWorldTickState): PendingWorldTick {
  if (!state.pending) throw new WorldTickStateError("no_pending", "There is no time skip waiting for review.");
  return state.pending;
}

function updateEvent(
  pending: PendingWorldTick,
  eventId: string,
  update: (event: WorldTickEvent) => WorldTickEvent,
): PendingWorldTick {
  if (!pending.events.some((event) => event.id === eventId)) {
    throw new WorldTickStateError("not_found", "That event is no longer in this time skip. Reload and try again.");
  }
  return { ...pending, events: pending.events.map((event) => (event.id === eventId ? update(event) : event)) };
}

export interface StartPendingWorldTickInput {
  elapsed: string;
  guidance: string;
  anchorMessageId: string | null;
  proposals: Array<{ text: string; characters: string[] }>;
  /** Taking the waiting offer with this id makes the tick answer that boundary and clears the offer. */
  offerId?: string | null;
  /** Where a replaced review came from, so suggesting again keeps answering the same boundary. */
  origin?: Pick<PendingWorldTick, "trigger" | "boundaryKey"> | null;
}

/**
 * Opens a review with the proposer's events. Events deferred on earlier ticks come back first,
 * as proposals the user must decide on again; they leave the deferred list until then.
 */
export function startPendingWorldTick(
  state: RoleplayWorldTickState,
  input: StartPendingWorldTickInput,
  options: WorldTickStateOptions = {},
): RoleplayWorldTickState {
  const now = options.now?.() ?? new Date().toISOString();
  const makeId = options.createId ?? createId;
  const carried = state.deferred.map((event) => ({
    ...event,
    status: "proposed" as const,
    carried: true,
    updatedAt: now,
  }));
  const fresh = input.proposals
    .map((proposal) => ({
      text: fitWorldTickEventText(proposal.text),
      characters: stringList(proposal.characters),
    }))
    .filter((proposal) => proposal.text)
    .slice(0, WORLD_TICK_LIMITS.proposedEventsPerTick)
    .map(
      (proposal): WorldTickEvent => ({
        id: makeId("world-tick-event"),
        text: proposal.text,
        status: "proposed",
        source: "model",
        edited: false,
        characters: proposal.characters,
        carried: false,
        createdAt: now,
        updatedAt: now,
      }),
    );
  const offer = input.offerId && state.offer?.id === input.offerId ? state.offer : null;
  const pending: PendingWorldTick = {
    id: makeId("world-tick"),
    trigger: offer?.trigger ?? input.origin?.trigger ?? "manual",
    boundaryKey: offer?.id ?? input.origin?.boundaryKey ?? null,
    elapsed: cleanWorldTickText(input.elapsed, WORLD_TICK_LIMITS.elapsedCharacters),
    guidance: cleanWorldTickText(input.guidance, WORLD_TICK_LIMITS.guidanceCharacters),
    anchorMessageId: input.anchorMessageId,
    events: [...carried, ...fresh].slice(0, WORLD_TICK_LIMITS.eventsPerTick),
    createdAt: now,
    updatedAt: now,
  };
  return bump({ ...state, pending, deferred: [], offer: offer ? null : state.offer }, now);
}

export function applyWorldTickCommand(
  state: RoleplayWorldTickState,
  command: WorldTickCommand,
  options: WorldTickStateOptions = {},
): RoleplayWorldTickState {
  const now = options.now?.() ?? new Date().toISOString();
  const makeId = options.createId ?? createId;

  if (command.type === "set_offers_enabled") {
    if (state.offersEnabled === command.enabled) return state;
    // Turning offers off also withdraws the one waiting; its boundary stays marked as offered.
    return bump({ ...state, offersEnabled: command.enabled, offer: command.enabled ? state.offer : null }, now);
  }

  if (command.type === "dismiss_offer") {
    // Already gone (taken or dismissed in another window) counts as done.
    if (state.offer?.id !== command.offerId) return state;
    return bump({ ...state, offer: null }, now);
  }

  if (command.type === "discard_pending") {
    const pending = requirePending(state);
    // Discarding means "no time passes". Anything the user had already put off, or that came back
    // from an earlier tick undecided, stays put off; everything else is dropped.
    const keep = pending.events
      .filter((event) => event.status === "deferred" || (event.carried && event.status !== "rejected"))
      .map((event) => ({ ...event, status: "deferred" as const, updatedAt: now }));
    return bump(
      { ...state, pending: null, deferred: [...state.deferred, ...keep].slice(-WORLD_TICK_LIMITS.deferredEvents) },
      now,
    );
  }

  const pending = requirePending(state);

  if (command.type === "set_elapsed") {
    const elapsed = cleanWorldTickText(command.elapsed, WORLD_TICK_LIMITS.elapsedCharacters);
    if (!elapsed) throw new WorldTickStateError("invalid_text", "Say how much time passes.");
    return bump({ ...state, pending: { ...pending, elapsed, updatedAt: now } }, now);
  }

  if (command.type === "add_event") {
    const text = cleanWorldTickText(command.text);
    if (!text) throw new WorldTickStateError("invalid_text", "Write what happens before adding it.");
    if (pending.events.length >= WORLD_TICK_LIMITS.eventsPerTick) {
      throw new WorldTickStateError(
        "invalid_text",
        `A time skip holds up to ${WORLD_TICK_LIMITS.eventsPerTick} events. Reject one to make room.`,
      );
    }
    const event: WorldTickEvent = {
      id: makeId("world-tick-event"),
      text,
      // The user wrote it, so it is already their decision.
      status: "accepted",
      source: "user",
      edited: false,
      characters: [],
      carried: false,
      createdAt: now,
      updatedAt: now,
    };
    return bump({ ...state, pending: { ...pending, events: [...pending.events, event], updatedAt: now } }, now);
  }

  if (command.type === "edit_event") {
    const text = cleanWorldTickText(command.text);
    if (!text) throw new WorldTickStateError("invalid_text", "An event can't be empty. Reject it instead.");
    const next = updateEvent(pending, command.eventId, (event) =>
      event.text === text
        ? event
        : { ...event, text, edited: event.source === "model" || event.edited, updatedAt: now },
    );
    return bump({ ...state, pending: { ...next, updatedAt: now } }, now);
  }

  const next = updateEvent(pending, command.eventId, (event) => ({ ...event, status: command.status, updatedAt: now }));
  return bump({ ...state, pending: { ...next, updatedAt: now } }, now);
}

/**
 * Moves a fully reviewed tick into the timeline. Accepted events are kept with the narrator message
 * that carries them; deferred events wait for the next tick; rejected events are gone.
 */
export function completePendingWorldTick(
  state: RoleplayWorldTickState,
  input: { tickId: string; messageId: string },
  options: WorldTickStateOptions = {},
): RoleplayWorldTickState {
  const now = options.now?.() ?? new Date().toISOString();
  const pending = requirePending(state);
  if (pending.id !== input.tickId) {
    throw new WorldTickStateError("not_found", "This time skip changed. Reload it before applying.");
  }
  assertWorldTickReviewed(pending);
  const accepted = pending.events.filter((event) => event.status === "accepted");
  const deferred = pending.events
    .filter((event) => event.status === "deferred")
    .map((event) => ({ ...event, updatedAt: now }));
  const applied: AppliedWorldTick = {
    id: pending.id,
    trigger: pending.trigger,
    boundaryKey: pending.boundaryKey,
    elapsed: pending.elapsed,
    messageId: input.messageId,
    events: accepted.map(({ id, text, source, edited, characters }) => ({ id, text, source, edited, characters })),
    appliedAt: now,
  };
  return bump(
    {
      ...state,
      pending: null,
      deferred: [...state.deferred, ...deferred].slice(-WORLD_TICK_LIMITS.deferredEvents),
      timeline: [...state.timeline, applied].slice(-WORLD_TICK_LIMITS.timelineTicks),
    },
    now,
  );
}

/** Applying needs a decision on every event and a stated amount of time. */
export function assertWorldTickReviewed(pending: PendingWorldTick): void {
  if (!pending.elapsed) throw new WorldTickStateError("invalid_text", "Say how much time passes.");
  const unreviewed = pending.events.filter((event) => event.status === "proposed").length;
  if (unreviewed > 0) {
    throw new WorldTickStateError(
      "unreviewed_events",
      `Accept, reject or put off the ${unreviewed === 1 ? "last event" : `${unreviewed} remaining events`} first.`,
    );
  }
}

/**
 * The narrator message that tells the story (and the writer) what happened off-screen. A time skip
 * the user already wrote into their message has been narrated by the time this lands, so it looks
 * back at that skip instead of announcing more time passing.
 */
export function worldTickNarration(
  elapsed: string,
  acceptedEvents: string[],
  tickTrigger: WorldTickTrigger = "manual",
): string {
  const span = elapsed.replace(/[.!]+$/, "");
  if (tickTrigger === "time_skip") {
    if (acceptedEvents.length === 0) return `*Meanwhile (${span}): nothing of note happened off-screen.*`;
    return [`*Meanwhile, off-screen (${span}):*`, ...acceptedEvents.map((text) => `- ${text}`)].join("\n");
  }
  const heading = `*Time passes: ${span}.*`;
  if (acceptedEvents.length === 0) return heading;
  return [heading, "", "While time passed:", ...acceptedEvents.map((text) => `- ${text}`)].join("\n");
}

/** Stable narrator message id per tick, so a retried apply can never write the message twice. */
export function worldTickMessageId(tickId: string): string {
  return `${tickId}-narration`;
}
