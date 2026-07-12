import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SetupJourneyIntent, SetupJourneyMode } from "../../engine/onboarding";
import { partializeSetupJourneyState } from "./ui/persistence";

interface SetupJourneyState {
  intent: SetupJourneyIntent | null;
  begin: (mode: SetupJourneyMode, originCharacterId?: string) => void;
  dismiss: () => void;
  resume: () => void;
  markConnection: (connectionId: string) => void;
  markCompleted: () => void;
  replaceIntent: (intent: SetupJourneyIntent) => void;
  clearIntent: () => void;
}

let nextJourneySequence = 0;

function createJourneyId(): string {
  nextJourneySequence += 1;
  return `setup-${Date.now().toString(36)}-${nextJourneySequence.toString(36)}`;
}

export const useSetupJourneyStore = create<SetupJourneyState>()(
  persist<SetupJourneyState, [], [], Pick<SetupJourneyState, "intent">>(
    (set) => ({
      intent: null,
      begin: (mode, originCharacterId) =>
        set({
          intent: {
            journeyId: createJourneyId(),
            mode,
            originCharacterId: originCharacterId ?? null,
            selectedConnectionId: null,
            dismissed: false,
            completed: false,
          },
        }),
      dismiss: () =>
        set((state) => (state.intent && !state.intent.dismissed ? { intent: { ...state.intent, dismissed: true } } : state)),
      resume: () =>
        set((state) => (state.intent?.dismissed ? { intent: { ...state.intent, dismissed: false } } : state)),
      markConnection: (connectionId) =>
        set((state) =>
          state.intent && state.intent.selectedConnectionId !== connectionId
            ? { intent: { ...state.intent, selectedConnectionId: connectionId } }
            : state,
        ),
      markCompleted: () =>
        set((state) => (state.intent && !state.intent.completed ? { intent: { ...state.intent, completed: true } } : state)),
      replaceIntent: (intent) => set({ intent }),
      clearIntent: () => set({ intent: null }),
    }),
    {
      name: "de-koi-setup-journey",
      storage: createJSONStorage(() => localStorage),
      partialize: partializeSetupJourneyState,
    },
  ),
);
