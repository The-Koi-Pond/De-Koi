import { ImagePromptReviewModal } from "../../../../../shared/components/ui/ImagePromptReviewModal";
import { Modal } from "../../../../../shared/components/ui/Modal";
import { useSpriteGeneration, type SpriteGenerationDialogProps } from "../hooks/use-sprite-generation";
import { GeneratingStep } from "./GeneratingStep";
import { ReviewStep } from "./ReviewStep";
import { SetupStep } from "./SetupStep";

/**
 * "Generate sprites": turns an appearance description into expression or full-body sprites with an image generation
 * connection, lets the person fix the cuts, frame and clean up each one, name them, and saves them to the character or
 * persona. The Sprites tabs keep it mounted and toggle `open`, so its results survive a close.
 */
export function SpriteGenerationDialog(props: SpriteGenerationDialogProps) {
  const dialog = useSpriteGeneration(props);
  const review = dialog.pendingReview;

  return (
    <>
      <Modal open={props.open} onClose={props.onClose} title="Generate sprites" width="max-w-3xl">
        {dialog.step === "setup" && <SetupStep dialog={dialog} onCancel={props.onClose} />}
        {dialog.step === "generating" && <GeneratingStep generation={dialog.generation} progress={dialog.progress} />}
        {dialog.step === "review" && <ReviewStep dialog={dialog} />}
      </Modal>
      <ImagePromptReviewModal
        open={props.open && review !== null}
        items={review?.items ?? []}
        isSubmitting={false}
        onCancel={() => review?.resolve(null)}
        onConfirm={(overrides) => review?.resolve(overrides)}
      />
    </>
  );
}
