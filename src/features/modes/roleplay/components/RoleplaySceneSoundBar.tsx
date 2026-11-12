import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { toUserMessage } from "../../../../shared/lib/error-message";
import { sceneSoundPlayer } from "../../../../shared/lib/scene-sound-player";
import { isMissingSoundEffectsPermission } from "../../../../shared/lib/sound-effects";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useSceneSoundAvailability } from "../hooks/use-roleplay-scene-sound";

/** What to tell the user when scene sounds can't be made. */
function sceneSoundFailureMessage(error: unknown): string {
  if (isMissingSoundEffectsPermission(error)) {
    return "Scene sound is paused: your ElevenLabs API key is missing the Sound Effects permission. Turn it on for the key at elevenlabs.io, then try again.";
  }
  return `Scene sound is paused. ${toUserMessage(error, { fallback: "The sound couldn't be made." })}`;
}

const BAR =
  "mb-1.5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 px-3 py-2 text-xs text-[var(--card-foreground)] shadow-sm backdrop-blur";
const ACTION =
  "rounded-lg bg-[var(--primary)] px-2.5 py-1 font-semibold text-[var(--primary-foreground)] disabled:opacity-40";
const QUIET_ACTION =
  "rounded-lg px-2 py-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

/**
 * Shown above the message box only when scene sound needs the user: the browser is holding sound back until a tap
 * (phones and some desktops), or the sounds can't be made. Otherwise it renders nothing.
 */
export function RoleplaySceneSoundBar() {
  const enabled = useUIStore((state) => state.roleplaySceneSound);
  const setEnabled = useUIStore((state) => state.setRoleplaySceneSound);
  const { ready } = useSceneSoundAvailability();
  const state = useSyncExternalStore(
    (listener) => sceneSoundPlayer.subscribe(listener),
    () => sceneSoundPlayer.getState(),
  );
  if (!enabled || !ready) return null;

  if (state.error) {
    return (
      <div role="alert" className={BAR}>
        <VolumeX size="0.875rem" className="shrink-0 text-amber-400" aria-hidden="true" />
        <span className="min-w-[12rem] flex-1 leading-snug">{sceneSoundFailureMessage(state.error)}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => sceneSoundPlayer.retry()} className={ACTION}>
            Try again
          </button>
          <button type="button" onClick={() => setEnabled(false)} className={QUIET_ACTION}>
            Turn off
          </button>
        </div>
      </div>
    );
  }

  if (state.locked && state.ambientId) {
    return (
      <div role="status" className={BAR}>
        <Volume2 size="0.875rem" className="shrink-0 text-sky-400" aria-hidden="true" />
        <span className="min-w-[12rem] flex-1 leading-snug">Your browser is holding scene sound until you tap.</span>
        <button type="button" onClick={() => void sceneSoundPlayer.unlock()} className={ACTION}>
          Play scene sound
        </button>
      </div>
    );
  }

  return null;
}
