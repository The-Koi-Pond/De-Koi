import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SetupJourneyIntent, SetupJourneyMode, SetupJourneyRecovery } from "../../engine/onboarding";
import { partializeSetupJourneyState } from "./ui/persistence";

interface SetupJourneyState {
  intent: SetupJourneyIntent | null;
  recovery: SetupJourneyRecovery | null;
  testedConnectionIds: string[];
  savedWithoutTestConnectionIds: string[];
  begin: (mode: SetupJourneyMode, originCharacterId?: string) => void;
  dismiss: () => void;
  resume: () => void;
  markConnection: (connectionId: string) => void;
  markConnectionTested: (connectionId: string) => void;
  markConnectionSavedWithoutTest: (connectionId: string) => void;
  markCompleted: (journeyId: string) => void;
  replaceIntent: (intent: SetupJourneyIntent) => void;
  clearIntent: () => void;
  recordRecovery: (recovery: SetupJourneyRecovery) => void;
  clearRecovery: () => void;
}

let nextJourneySequence = 0;

function createJourneyId(): string {
  nextJourneySequence += 1;
  return `setup-${Date.now().toString(36)}-${nextJourneySequence.toString(36)}`;
}

export const useSetupJourneyStore = create<SetupJourneyState>()(
  persist<SetupJourneyState, [], [], Pick<SetupJourneyState, "intent" | "recovery">>(
    (set) => ({
      intent: null,
      recovery: null,
      testedConnectionIds: [],
      savedWithoutTestConnectionIds: [],
      begin: (mode, originCharacterId) =>
        set((state) => ({
          intent: {
            journeyId: createJourneyId(),
            mode,
            originCharacterId: originCharacterId ?? null,
            selectedConnectionId: null,
            dismissed: false,
            completed: false,
          },
          ...(state.intent?.completed ? { recovery: null } : {}),
        })),
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
      markConnectionTested: (connectionId) =>
        set((state) => ({
          testedConnectionIds: state.testedConnectionIds.includes(connectionId)
            ? state.testedConnectionIds
            : [...state.testedConnectionIds, connectionId],
          intent: state.intent ? { ...state.intent, selectedConnectionId: connectionId, dismissed: false } : null,
        })),
      markConnectionSavedWithoutTest: (connectionId) =>
        set((state) => ({
          savedWithoutTestConnectionIds: state.savedWithoutTestConnectionIds.includes(connectionId)
            ? state.savedWithoutTestConnectionIds
            : [...state.savedWithoutTestConnectionIds, connectionId],
          intent: state.intent ? { ...state.intent, selectedConnectionId: connectionId, dismissed: false } : null,
        })),
      markCompleted: (journeyId) =>
        set((state) =>
          state.intent && state.intent.journeyId === journeyId && !state.intent.completed
            ? { intent: { ...state.intent, completed: true } }
            : state,
        ),
      replaceIntent: (intent) => set({ intent }),
      clearIntent: () => set({ intent: null, testedConnectionIds: [], savedWithoutTestConnectionIds: [] }),
      recordRecovery: (recovery) => set({ recovery }),
      clearRecovery: () => set({ recovery: null }),
    }),
    {
      name: "de-koi-setup-journey",
      storage: createJSONStorage(() => localStorage),
      partialize: partializeSetupJourneyState,
    },
  ),
);
