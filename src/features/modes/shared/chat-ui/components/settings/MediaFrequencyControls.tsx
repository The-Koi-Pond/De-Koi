import { cn } from "../../../../../../shared/lib/utils";

const FREQUENCIES = ["never", "rare", "sometimes"] as const;
type MediaFrequency = (typeof FREQUENCIES)[number];

const LABELS: Record<MediaFrequency, string> = {
  never: "Never",
  rare: "Rare",
  sometimes: "Sometimes",
};

/**
 * Per-character never / rare / sometimes for a Conversation chat's media (photos when texting first, voice notes).
 * `unavailable` explains what's missing instead of showing the pickers.
 */
export function MediaFrequencyControls({
  title,
  description,
  unavailable,
  frequencyFor,
  stored,
  chatCharIds,
  charNameMap,
  onChange,
}: {
  title: string;
  description: string;
  unavailable: string | null;
  frequencyFor: (characterId: string) => MediaFrequency;
  stored: unknown;
  chatCharIds: string[];
  charNameMap: Map<string, string>;
  onChange: (next: Record<string, MediaFrequency>) => void;
}) {
  const current =
    stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, MediaFrequency>) : {};

  return (
    <div className="space-y-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2.5">
      <span className="text-xs font-medium">{title}</span>
      <p className="text-[0.625rem] text-[var(--muted-foreground)]">{unavailable ?? description}</p>
      {!unavailable &&
        chatCharIds.map((characterId) => {
          const value = frequencyFor(characterId);
          const name = charNameMap.get(characterId) ?? "Character";
          return (
            <div key={characterId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[0.6875rem]">{name}</span>
              <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`${title}: ${name}`}>
                {FREQUENCIES.map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    role="radio"
                    aria-checked={value === frequency}
                    onClick={() => onChange({ ...current, [characterId]: frequency })}
                    className={cn(
                      "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors",
                      value === frequency
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
