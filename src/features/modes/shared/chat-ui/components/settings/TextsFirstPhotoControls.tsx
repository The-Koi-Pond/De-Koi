import {
  UNPROMPTED_PHOTO_FREQUENCIES,
  unpromptedPhotoFrequency,
  type UnpromptedPhotoFrequency,
} from "../../../../../../engine/modes/chat/autonomous/unprompted-photos";
import { cn } from "../../../../../../shared/lib/utils";

const LABELS: Record<UnpromptedPhotoFrequency, string> = {
  never: "Never",
  rare: "Rare",
  sometimes: "Sometimes",
};

/** Per-character "photos when texting first" frequency for a Conversation chat. */
export function TextsFirstPhotoControls({
  metadata,
  chatCharIds,
  charNameMap,
  onChange,
}: {
  metadata: Record<string, unknown>;
  chatCharIds: string[];
  charNameMap: Map<string, string>;
  onChange: (next: Record<string, UnpromptedPhotoFrequency>) => void;
}) {
  const hasImageConnection = typeof metadata.imageGenConnectionId === "string" && !!metadata.imageGenConnectionId;
  const stored =
    metadata.unpromptedPhotoFrequency && typeof metadata.unpromptedPhotoFrequency === "object"
      ? (metadata.unpromptedPhotoFrequency as Record<string, UnpromptedPhotoFrequency>)
      : {};

  return (
    <div className="space-y-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2.5">
      <span className="text-xs font-medium">Photos when texting first</span>
      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
        {hasImageConnection
          ? "How often a text a character sends first comes with a selfie. At most one photo until you reply."
          : "Needs a Selfie Connection (under Commands) before characters can send photos."}
      </p>
      {hasImageConnection &&
        chatCharIds.map((characterId) => {
          const current = unpromptedPhotoFrequency(metadata, characterId);
          return (
            <div key={characterId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[0.6875rem]">{charNameMap.get(characterId) ?? "Character"}</span>
              <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`Photo frequency`}>
                {UNPROMPTED_PHOTO_FREQUENCIES.map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    role="radio"
                    aria-checked={current === frequency}
                    onClick={() => onChange({ ...stored, [characterId]: frequency })}
                    className={cn(
                      "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors",
                      current === frequency
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--background)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    {LABELS[frequency]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
