import { describe, expect, it } from "vitest";
import { followVoiceReactions } from "./voice-reactions";
import type { VoiceSession, VoiceSessionEvent, VoiceSessionPhase, VoiceSessionSnapshot } from "./voice-session";

/** Just enough of a session to drive reactions with typed events. */
function fakeSession() {
  const listeners = new Set<(event: VoiceSessionEvent) => void>();
  const session = {
    id: 1,
    getSnapshot: () => ({ phase: "connecting" }) as VoiceSessionSnapshot,
    onEvent: (listener: (event: VoiceSessionEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as VoiceSession;
  const emit = (event: VoiceSessionEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  return {
    session,
    listeners,
    phase: (phase: VoiceSessionPhase) => emit({ type: "phase", sessionId: 1, phase }),
    heard: (text: string, turn: number) => emit({ type: "heard", sessionId: 1, turn, text }),
    reply: (text: string, turn: number) => emit({ type: "reply", sessionId: 1, turn, text }),
    ended: () => emit({ type: "ended", sessionId: 1 }),
  };
}

describe("followVoiceReactions", () => {
  it("listens, thinks, speaks with the reply's mood and looks startled when cut off", () => {
    const fake = fakeSession();
    const reactions = followVoiceReactions(fake.session);
    const seen: string[] = [];
    reactions.subscribe(() => {
      const { activity, expression } = reactions.getReaction();
      seen.push(`${activity}:${expression}`);
    });
    expect(reactions.getReaction()).toEqual({ activity: "idle", expression: "neutral" });

    fake.phase("listening");
    fake.phase("transcribing"); // still just listening: no change to show
    fake.heard("tell me something nice", 1);
    fake.phase("thinking");
    fake.reply("Oh, that makes me so happy.", 1);
    fake.phase("speaking");
    fake.phase("interrupted");
    fake.phase("speaking"); // it was only noise: back to the reply's mood
    fake.phase("listening");

    expect(seen).toEqual([
      "listening:neutral",
      "thinking:thinking",
      "speaking:happy",
      "interrupted:surprised",
      "speaking:happy",
      "listening:neutral",
    ]);
  });

  it("a new turn starts from a neutral face, not the last reply's mood", () => {
    const fake = fakeSession();
    const reactions = followVoiceReactions(fake.session, (reply) => (reply.includes("ugh") ? "angry" : "neutral"));
    fake.reply("ugh, fine.", 1);
    fake.phase("speaking");
    expect(reactions.getReaction().expression).toBe("angry");

    fake.heard("sorry", 2);
    fake.phase("thinking");
    fake.phase("speaking"); // the new reply hasn't streamed yet
    expect(reactions.getReaction()).toEqual({ activity: "speaking", expression: "neutral" });
  });

  it("stops following once the call has ended", () => {
    const fake = fakeSession();
    const reactions = followVoiceReactions(fake.session);
    fake.phase("thinking");
    fake.phase("ended");
    fake.ended();
    expect(reactions.getReaction()).toEqual({ activity: "idle", expression: "neutral" });
    expect(fake.listeners.size).toBe(0);
  });
});
