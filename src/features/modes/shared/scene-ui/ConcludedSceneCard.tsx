import { useState } from "react";
import { Film } from "lucide-react";

import { SceneActionButton } from "./SceneActionButton";
import { SCENE_ACTION, SCENE_PANEL, SCENE_PRIMARY_ACTION } from "./scene-ui-styles";

export interface ConcludedSceneCardProps {
  /** The scene's description, shown in italics. */
  description: string;
  /** Opens the chat the scene came from; left out when the scene has none. */
  onBackToOrigin?: () => void;
  onReopen: () => Promise<unknown>;
}

/** Takes the message box's place in a concluded scene: what it was, the way back, and Reopen scene. */
export function ConcludedSceneCard({ description, onBackToOrigin, onReopen }: ConcludedSceneCardProps) {
  const [reopening, setReopening] = useState(false);

  async function reopen() {
    if (reopening) return;
    setReopening(true);
    try {
      await onReopen();
    } finally {
      setReopening(false);
    }
  }

  return (
    <section aria-label="Concluded scene" className={`mb-3 ${SCENE_PANEL} items-start`}>
      <Film size="1rem" className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
      <div className="min-w-[10rem] flex-1">
        <p className="font-semibold">Scene</p>
        {description.trim() && <p className="mt-0.5 italic leading-snug opacity-80">{description.trim()}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {onBackToOrigin && (
          <SceneActionButton className={SCENE_ACTION} onClick={onBackToOrigin}>
            Back to conversation
          </SceneActionButton>
        )}
        <SceneActionButton
          className={SCENE_PRIMARY_ACTION}
          disabledReason={reopening ? "Wait until the scene is reopened." : null}
          onClick={() => void reopen()}
        >
          {reopening ? "Reopening..." : "Reopen scene"}
        </SceneActionButton>
      </div>
    </section>
  );
}
