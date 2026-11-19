import { SpriteCleanupEditor, SpriteFrameEditor, type SpriteInfo } from "../../sprites/index";

export function CharacterSpriteEditors({
  framingSprite,
  savingFrame,
  wandCleanupSprite,
  savingWandCleanup,
  displayExpression,
  onApplyFrame,
  onCloseFrame,
  onApplyWandCleanup,
  onCloseWandCleanup,
}: {
  framingSprite: SpriteInfo | null;
  savingFrame: boolean;
  wandCleanupSprite: SpriteInfo | null;
  savingWandCleanup: boolean;
  displayExpression: (stored: string) => string;
  onApplyFrame: (croppedDataUrl: string) => void | Promise<void>;
  onCloseFrame: () => void;
  onApplyWandCleanup: (cleanedDataUrl: string) => void | Promise<void>;
  onCloseWandCleanup: () => void;
}) {
  return (
    <>
      {framingSprite && (
        <SpriteFrameEditor
          imageUrl={framingSprite.url}
          label={displayExpression(framingSprite.expression)}
          applying={savingFrame}
          onApply={onApplyFrame}
          onClose={onCloseFrame}
        />
      )}

      {wandCleanupSprite && (
        <SpriteCleanupEditor
          imageUrl={wandCleanupSprite.url}
          label={displayExpression(wandCleanupSprite.expression)}
          applying={savingWandCleanup}
          onApply={onApplyWandCleanup}
          onClose={onCloseWandCleanup}
        />
      )}
    </>
  );
}
