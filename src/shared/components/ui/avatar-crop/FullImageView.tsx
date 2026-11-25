import { X } from "lucide-react";
import { useEscapeOverlay } from "../../../hooks/use-escape-overlay";

/**
 * The whole picture over the app. Any click inside closes it, and so does Escape while it is the topmost overlay.
 * Mounted only while open, so opening puts it on top of the overlay stack.
 */
export function FullImageView({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEscapeOverlay(onClose);

  return (
    <div
      data-crop-full
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <img
        src={src || undefined}
        alt={alt}
        className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
      />
      <button
        type="button"
        aria-label="Close full image"
        className="absolute right-3 top-3 rounded-xl bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
