import { useState } from "react";
import { Film } from "lucide-react";

import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { SceneActionButton } from "./SceneActionButton";
import { SCENE_ACTION, SCENE_DESTRUCTIVE_ACTION, SCENE_PANEL, SCENE_PRIMARY_ACTION } from "./scene-ui-styles";

type SceneBarAction = "end" | "discard" | "convert";

const RUNNING_REASON: Record<SceneBarAction, string> = {
  end: "Wait until the scene summary is saved.",
  discard: "Wait until the scene is discarded.",
  convert: "Wait until the scene is converted.",
};

export interface EndSceneBarProps {
  /** Opens the chat the scene came from; left out when the scene has none. */
  onBackToOrigin?: () => void;
  onConclude: () => Promise<unknown>;
  onDiscard: () => Promise<unknown>;
  onConvert: () => Promise<unknown>;
  /** A reply is streaming in the scene, so it can't be converted yet. */
  isStreaming?: boolean;
  /** A copy of this scene is already being made. */
  isForking?: boolean;
}

/** Sits above the message box of an active scene: back to the origin, end with a summary, discard, or convert. */
export function EndSceneBar({
  onBackToOrigin,
  onConclude,
  onDiscard,
  onConvert,
  isStreaming = false,
  isForking = false,
}: EndSceneBarProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [running, setRunning] = useState<SceneBarAction | null>(null);
  const runningReason = running ? RUNNING_REASON[running] : null;
  const convertBlockedReason =
    runningReason ??
    (isStreaming
      ? "Wait for the reply to finish."
      : isForking
        ? "Wait until the copy of this scene is finished."
        : null);

  async function run(action: SceneBarAction, task: () => Promise<unknown>) {
    setRunning(action);
    try {
      await task();
    } finally {
      setRunning(null);
    }
  }

  function endAndSave() {
    if (running) return;
    void run("end", async () => {
      await onConclude();
      setConfirmingEnd(false);
    });
  }

  async function askToDiscard() {
    if (running) return;
    setConfirmingEnd(false);
    const confirmed = await showConfirmDialog({
      title: "Discard this scene?",
      message: "This will permanently delete the scene without saving a summary or memory.",
      confirmLabel: "Discard",
      cancelLabel: "Keep scene",
      tone: "destructive",
    });
    if (confirmed) await run("discard", onDiscard);
  }

  async function askToConvert() {
    if (running || convertBlockedReason) return;
    const confirmed = await showConfirmDialog({
      title: "Convert this scene into a standalone roleplay?",
      message:
        "This will create a new roleplay chat from the current scene and detach the original scene from its conversation. No scene summary or character memory will be written back to the original conversation.",
      confirmLabel: "Convert",
      cancelLabel: "Cancel",
      tone: "destructive",
    });
    if (confirmed) await run("convert", onConvert);
  }

  return (
    <div className={`mb-1.5 ${SCENE_PANEL}`} data-testid="end-scene-bar">
      <Film size="0.875rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
      <span role="status" aria-live="polite" className="min-w-[8rem] flex-1 font-medium leading-snug">
        {confirmingEnd ? "End and save summary?" : "Scene in progress"}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {onBackToOrigin && (
          <SceneActionButton className={SCENE_ACTION} onClick={onBackToOrigin}>
            Back to conversation
          </SceneActionButton>
        )}
        {confirmingEnd ? (
          <>
            <SceneActionButton className={SCENE_PRIMARY_ACTION} disabledReason={runningReason} onClick={endAndSave}>
              {running === "end" ? "Saving..." : "Yes"}
            </SceneActionButton>
            <SceneActionButton
              className={SCENE_ACTION}
              disabledReason={runningReason}
              onClick={() => setConfirmingEnd(false)}
            >
              No
            </SceneActionButton>
          </>
        ) : (
          <SceneActionButton
            className={SCENE_PRIMARY_ACTION}
            disabledReason={runningReason}
            onClick={() => setConfirmingEnd(true)}
          >
            End scene
          </SceneActionButton>
        )}
        <SceneActionButton
          className={SCENE_DESTRUCTIVE_ACTION}
          disabledReason={runningReason}
          onClick={() => void askToDiscard()}
        >
          {running === "discard" ? "Discarding..." : "Discard"}
        </SceneActionButton>
        <SceneActionButton
          className={SCENE_ACTION}
          disabledReason={convertBlockedReason}
          onClick={() => void askToConvert()}
        >
          {running === "convert" ? "Converting..." : "Convert"}
        </SceneActionButton>
      </div>
    </div>
  );
}
