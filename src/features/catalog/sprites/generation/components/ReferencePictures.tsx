import { ImagePlus, X } from "lucide-react";
import { useId, type ChangeEvent } from "react";

import type { SpriteGenerationController } from "../hooks/use-sprite-generation";
import { hintText, sectionLabel } from "./dialog-styles";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("The picture could not be read"));
    reader.readAsDataURL(file);
  });
}

const thumbClass =
  "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--secondary)]";

/** "Reference images": the current avatar and up to four uploaded pictures, sent with every request. */
export function ReferencePictures({ dialog }: { dialog: SpriteGenerationController }) {
  const headingId = useId();
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl) dialog.addUpload(dataUrl);
  };

  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className={sectionLabel}>
          Reference images (optional, up to 4)
        </h3>
        <p className={hintText}>
          Upload reference images of the character to improve consistency. Multiple angles or the existing avatar work
          well.
        </p>
      </div>

      {dialog.avatarUrl && (
        <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={dialog.useAvatar}
            onChange={(event) => dialog.setUseAvatar(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          <img src={dialog.avatarUrl} alt="" className="h-8 w-8 rounded object-cover" />
          Use current avatar as a reference image
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {dialog.avatarOn && dialog.avatarUrl && (
          <div className={thumbClass}>
            <img src={dialog.avatarUrl} alt="Current avatar" className="h-full w-full object-cover" />
            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[0.625rem] text-white">
              Avatar
            </span>
          </div>
        )}
        {dialog.uploads.map((upload, index) => (
          <div key={`${index}-${upload.length}`} className="flex flex-col items-center gap-1">
            <div className={thumbClass}>
              <img src={upload} alt={`Reference image ${index + 1}`} className="h-full w-full object-cover" />
            </div>
            <button
              type="button"
              onClick={() => dialog.removeUpload(index)}
              aria-label={`Remove reference image ${index + 1}`}
              className="inline-flex items-center gap-1 rounded px-1 text-[0.6875rem] text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
            >
              <X size="0.75rem" aria-hidden="true" />
              Remove
            </button>
          </div>
        ))}
        {dialog.canAddUpload && (
          <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border)] text-[0.6875rem] text-[var(--muted-foreground)] hover:bg-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--ring)]">
            <ImagePlus size="1rem" aria-hidden="true" />
            Upload
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => void handleFile(event)} />
          </label>
        )}
      </div>
    </section>
  );
}
