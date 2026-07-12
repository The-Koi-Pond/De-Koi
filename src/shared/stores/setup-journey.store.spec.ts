import { beforeEach, describe, expect, it } from "vitest";
import type { SetupJourneyIntent } from "../../engine/onboarding";
import { useSetupJourneyStore } from "./setup-journey.store";

const replacement: SetupJourneyIntent = {
  journeyId: "replacement",
  mode: "roleplay",
  originCharacterId: "character-2",
  selectedConnectionId: "connection-2",
  dismissed: true,
  completed: false,
};

describe("useSetupJourneyStore", () => {
  beforeEach(() => useSetupJourneyStore.getState().clearIntent());

  it("beginning again preserves the latest requested mode", () => {
    useSetupJourneyStore.getState().begin("conversation", "character-1");
    useSetupJourneyStore.getState().begin("game");

    expect(useSetupJourneyStore.getState().intent).toMatchObject({ mode: "game", originCharacterId: null });
  });

  it("assigns a unique identity to each journey even when launch fields are identical", () => {
    useSetupJourneyStore.getState().begin("conversation", "character-1");
    const first = useSetupJourneyStore.getState().intent?.journeyId;
    useSetupJourneyStore.getState().begin("conversation", "character-1");

    expect(useSetupJourneyStore.getState().intent?.journeyId).not.toBe(first);
  });

  it("replaces intent with the latest request", () => {
    useSetupJourneyStore.getState().begin("conversation");
    useSetupJourneyStore.getState().replaceIntent(replacement);

    expect(useSetupJourneyStore.getState().intent).toEqual(replacement);
  });

  it("dismisses without discarding intent and resumes by clearing only dismissal", () => {
    useSetupJourneyStore.getState().replaceIntent({ ...replacement, dismissed: false });
    useSetupJourneyStore.getState().dismiss();
    expect(useSetupJourneyStore.getState().intent).toEqual(replacement);

    useSetupJourneyStore.getState().resume();

    expect(useSetupJourneyStore.getState().intent).toEqual({ ...replacement, dismissed: false });
  });

  it("marks the selected connection", () => {
    useSetupJourneyStore.getState().begin("game");
    useSetupJourneyStore.getState().markConnection("connection-1");

    expect(useSetupJourneyStore.getState().intent?.selectedConnectionId).toBe("connection-1");
  });

  it("duplicate completion is idempotent", () => {
    useSetupJourneyStore.getState().begin("game");
    useSetupJourneyStore.getState().markCompleted(useSetupJourneyStore.getState().intent!.journeyId);
    const completed = useSetupJourneyStore.getState().intent;
    useSetupJourneyStore.getState().markCompleted(completed!.journeyId);

    expect(useSetupJourneyStore.getState().intent).toBe(completed);
  });

  it("does not complete a replacement intent from an older in-flight journey", () => {
    useSetupJourneyStore.getState().begin("conversation");
    const olderJourneyId = useSetupJourneyStore.getState().intent!.journeyId;
    useSetupJourneyStore.getState().begin("roleplay", "character-1");

    useSetupJourneyStore.getState().markCompleted(olderJourneyId);

    expect(useSetupJourneyStore.getState().intent).toMatchObject({ mode: "roleplay", completed: false });
  });
});
