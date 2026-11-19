import { SpriteCleanupEditor, SpriteFrameEditor, type SpriteInfo } from "../../../sprites/index";

interface PersonaSpriteEditorsProps {
  framingSprite: SpriteInfo | null;
  savingFrame: boolean;
  wandCleanupSprite: SpriteInfo | null;
  savingWandCleanup: boolean;
  displayExpression: (expression: string) => string;
  onApplySpriteFrame: (croppedDataUrl: string) => void | Promise<void>;
  onCloseFrame: () => void;
  onApplyWandCleanup: (cleanedDataUrl: string) => void | Promise<void>;
  onCloseWandCleanup: () => void;
}

export function PersonaSpriteEditors({
  framingSprite,
  savingFrame,
  wandCleanupSprite,
  savingWandCleanup,
  displayExpression,
  onApplySpriteFrame,
  onCloseFrame,
  onApplyWandCleanup,
  onCloseWandCleanup,
}: PersonaSpriteEditorsProps) {
  return (
    <>
      {framingSprite && (
        <SpriteFrameEditor
          imageUrl={framingSprite.url}
          label={displayExpression(framingSprite.expression)}
          filename={framingSprite.filename}
          applying={savingFrame}
          onApply={onApplySpriteFrame}
          onClose={onCloseFrame}
        />
      )}

      {wandCleanupSprite && (
        <SpriteCleanupEditor
          imageUrl={wandCleanupSprite.url}
          label={displayExpression(wandCleanupSprite.expression)}
          filename={wandCleanupSprite.filename}
          applying={savingWandCleanup}
          onApply={onApplyWandCleanup}
          onClose={onCloseWandCleanup}
        />
      )}
    </>
  );
}
