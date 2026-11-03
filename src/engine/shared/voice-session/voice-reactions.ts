// ──────────────────────────────────────────────
// Voice reactions: what the character's face shows during a call
// ──────────────────────────────────────────────
// Follows a voice session's events and turns them into an expression: attentive while you talk, thinking while the
// reply is being written, the reply's mood while it is spoken, startled when you cut in. Expression names are the
// Expression Engine's (neutral, thinking, surprised, happy…), so a character's sprites for them work here the same
// way they do in Roleplay. Nothing here knows about React or audio: a call screen, a sprite stage or a future
// animated avatar all subscribe the same way.
import { detectExpression } from "../expressions/detect-expression";
import type { VoiceSession, VoiceSessionEvent, VoiceSessionPhase } from "./voice-session";

type VoiceReactionActivity = "idle" | "listening" | "thinking" | "speaking" | "interrupted";

export interface VoiceReaction {
  readonly activity: VoiceReactionActivity;
  /** An Expression Engine expression name. */
  readonly expression: string;
}

export interface VoiceReactions {
  getReaction(): VoiceReaction;
  /** Called whenever the reaction changes. */
  subscribe(listener: () => void): () => void;
}

/** Reads the mood of the reply spoken so far as an expression name. */
export type VoiceReplyMood = (replySoFar: string) => string;

const ACTIVITY: Record<VoiceSessionPhase, VoiceReactionActivity> = {
  connecting: "idle",
  listening: "listening",
  transcribing: "listening",
  thinking: "thinking",
  speaking: "speaking",
  interrupted: "interrupted",
  ended: "idle",
  error: "idle",
};

function reactionFor(activity: VoiceReactionActivity, reply: string, mood: VoiceReplyMood): VoiceReaction {
  switch (activity) {
    case "thinking":
      return { activity, expression: "thinking" };
    case "speaking":
      return { activity, expression: reply ? mood(reply) : "neutral" };
    case "interrupted":
      return { activity, expression: "surprised" };
    default:
      return { activity, expression: "neutral" };
  }
}

/**
 * Follows `session` until it ends. The reply's mood comes from its words, the fallback sprites use when the
 * Expression Engine hasn't picked an expression; pass `mood` to read it another way.
 */
export function followVoiceReactions(session: VoiceSession, mood: VoiceReplyMood = detectExpression): VoiceReactions {
  const listeners = new Set<() => void>();
  let activity: VoiceReactionActivity = ACTIVITY[session.getSnapshot().phase];
  let reply = "";
  let reaction: VoiceReaction = reactionFor(activity, reply, mood);

  const refresh = () => {
    const next = reactionFor(activity, reply, mood);
    if (next.activity === reaction.activity && next.expression === reaction.expression) return;
    reaction = next;
    for (const listener of [...listeners]) listener();
  };

  const stopFollowing = session.onEvent((event: VoiceSessionEvent) => {
    switch (event.type) {
      case "phase":
        activity = ACTIVITY[event.phase];
        break;
      case "heard":
        reply = ""; // a new turn: the last reply's mood is over
        break;
      case "reply":
        reply = event.text;
        break;
      case "ended":
        stopFollowing();
        break;
      default:
        return;
    }
    refresh();
  });

  return {
    getReaction: () => reaction,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
