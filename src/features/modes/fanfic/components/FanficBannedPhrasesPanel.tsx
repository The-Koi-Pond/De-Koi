import { useEffect, useState } from "react";
import { Ban, Loader2, RotateCcw, Save } from "lucide-react";
import {
  FANFIC_BANNED_PHRASES_MAX,
  FANFIC_DEFAULT_BANNED_PHRASES,
  normalizeFanficBannedPhrases,
} from "../../../../engine/modes/fanfic/phrase-bans";
import { cn } from "../../../../shared/lib/utils";
import { FanficButton, fanficInputClass } from "./fanfic-ui";

/**
 * The fic's banned phrases. On a local model they're kept out while it writes: the text backs up to just before a
 * banned phrase and resamples with it ruled out at that spot. Hosted models can't do that, so the list only applies
 * there once the fic runs on a local connection.
 */
export function FanficBannedPhrasesPanel({
  phrases,
  customized,
  supported,
  onSave,
}: {
  /** The list in effect (the fic's own, or the defaults). */
  phrases: string[];
  /** False while the fic still uses the default list. */
  customized: boolean;
  supported: boolean;
  /** null resets to the default list. */
  onSave: (phrases: string[] | null) => Promise<void>;
}) {
  const savedText = phrases.join("\n");
  const [text, setText] = useState(savedText);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(savedText), [savedText]);
  const draft = normalizeFanficBannedPhrases(text.split("\n"));
  const dirty = draft.join("\n") !== savedText;

  const save = async (next: string[] | null) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Banned phrases"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4"
    >
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
        <Ban size="0.95rem" aria-hidden="true" />
        Banned phrases
      </h3>
      <p className="text-xs leading-snug text-[var(--muted-foreground)]">
        {supported
          ? "This fic runs on a local model, so these are kept out while it writes: when one shows up, the model backs up to just before it and writes that spot again with the phrase ruled out. Each new chapter is cleaned the same way right after it's written."
          : "Only local models can keep phrases out while they write (the built-in local model, or a llama.cpp server on this computer). Hosted models can't, so on this fic's connection the list is kept for when it runs locally."}
      </p>
      <label htmlFor="fanfic-banned-phrases" className="text-xs text-[var(--muted-foreground)]">
        One per line, up to {FANFIC_BANNED_PHRASES_MAX}. Whole words, any capitalization.
      </label>
      <textarea
        id="fanfic-banned-phrases"
        rows={6}
        className={cn(fanficInputClass, "resize-y font-mono text-xs leading-relaxed")}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {dirty && (
          <FanficButton tone="primary" disabled={saving} onClick={() => void save(draft)}>
            {saving ? (
              <Loader2 size="0.85rem" className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size="0.85rem" aria-hidden="true" />
            )}
            Save list
          </FanficButton>
        )}
        {customized && (
          <FanficButton disabled={saving} onClick={() => void save(null)}>
            <RotateCcw size="0.85rem" aria-hidden="true" />
            Use the default list ({FANFIC_DEFAULT_BANNED_PHRASES.length})
          </FanficButton>
        )}
      </div>
    </section>
  );
}
