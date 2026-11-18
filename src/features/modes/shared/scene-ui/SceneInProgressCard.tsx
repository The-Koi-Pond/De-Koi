import { Film } from "lucide-react";

import { parseChatMetadata } from "../../../../shared/lib/chat-display";
import { SceneActionButton } from "./SceneActionButton";
import { SCENE_PANEL, SCENE_PRIMARY_ACTION } from "./scene-ui-styles";

/** A chat the origin knows about: its linked chat or its active scene. */
export interface SceneOriginRelatedChat {
  id: string;
  name: string;
  metadata?: string | Record<string, unknown> | null;
}

/**
 * The origin's active scene when it exists and is still active; null otherwise. Reads the chats the surface already
 * loaded, so the card adds no request of its own.
 */
export function activeSceneOfOrigin(
  originMetadata: Record<string, unknown>,
  relatedChats: readonly SceneOriginRelatedChat[] | undefined,
): { chatId: string; name: string } | null {
  const sceneChatId =
    typeof originMetadata.activeSceneChatId === "string" ? originMetadata.activeSceneChatId.trim() : "";
  if (!sceneChatId) return null;
  const scene = relatedChats?.find((chat) => chat.id === sceneChatId);
  if (!scene || parseChatMetadata(scene.metadata).sceneStatus !== "active") return null;
  return { chatId: sceneChatId, name: scene.name };
}

/** Shown at the bottom of an origin chat's messages while its scene is being played. */
export function SceneInProgressCard({ sceneName, onGoToScene }: { sceneName: string; onGoToScene: () => void }) {
  return (
    <section aria-label="Scene in progress" className={`mx-auto my-3 max-w-xl ${SCENE_PANEL}`}>
      <Film size="1rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
      <div className="min-w-[10rem] flex-1">
        <p className="font-semibold">A scene is in progress</p>
        {sceneName.trim() && <p className="mt-0.5 leading-snug opacity-80">{sceneName.trim()}</p>}
      </div>
      <SceneActionButton className={SCENE_PRIMARY_ACTION} onClick={onGoToScene}>
        Go to scene
      </SceneActionButton>
    </section>
  );
}
