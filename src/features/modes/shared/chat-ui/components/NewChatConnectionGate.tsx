import { useEffect } from "react";
import { useSetupJourneyStore } from "../../../../../shared/stores/setup-journey.store";

type Mode = "conversation" | "roleplay" | "game";

/** Compatibility delegate: mode routes record intent; the app shell renders the shared setup journey. */
export function NewChatConnectionGate({ mode, onClose: _onClose }: { mode: Mode; onClose: () => void }) {
  const intent = useSetupJourneyStore((state) => state.intent);
  useEffect(() => {
    if (!intent || intent.mode !== mode || intent.completed) useSetupJourneyStore.getState().begin(mode);
  }, [intent, mode]);
  return null;
}
