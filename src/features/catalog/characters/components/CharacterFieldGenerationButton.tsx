import { useRef, useState } from "react";
import { Loader2, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import type { DepthPrompt } from "../../../../engine/contracts/types/character";
import { connectionCatalogApi } from "../../../../shared/api/connection-catalog-api";
import { llmApi } from "../../../../shared/api/llm-api";
import {
  CHARACTER_FIELD_LABELS,
  generateCharacterField,
  type CharacterFieldGenerationField,
  type CharacterFieldGenerationInput,
  type CharacterFieldGenerationValue,
} from "../lib/character-field-generation";

type CharacterFieldGenerationButtonProps = CharacterFieldGenerationInput & {
  field: CharacterFieldGenerationField;
  mode?: "preview" | "direct";
  onApply: (value: CharacterFieldGenerationValue) => void;
  className?: string;
};

function isDepthPrompt(value: CharacterFieldGenerationValue): value is DepthPrompt {
  return !Array.isArray(value) && typeof value === "object";
}

export function CharacterFieldGenerationButton({
  field,
  data,
  comment,
  mode = "preview",
  onApply,
  className,
}: CharacterFieldGenerationButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<CharacterFieldGenerationValue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const label = CHARACTER_FIELD_LABELS[field];

  const handleGenerate = async () => {
    if (generating) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setGenerating(true);

    try {
      const connectionId = await connectionCatalogApi.resolveDefaultTextConnectionId();
      const value = await generateCharacterField({
        field,
        data,
        comment,
        connectionId,
        llm: llmApi,
        signal: abort.signal,
      });
      if (mode === "direct") {
        onApply(value);
        toast.success(`${label} generated.`);
      } else {
        setPreview(value);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : `${label} generation failed.`);
      }
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setGenerating(false);
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className={
          className ??
          "shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] disabled:cursor-wait disabled:opacity-60"
        }
        title={`Generate ${label}`}
        aria-label={`Generate ${label}`}
        aria-busy={generating}
      >
        {generating ? <Loader2 size="0.875rem" className="animate-spin" /> : <Wand2 size="0.875rem" />}
      </button>
      {preview !== null && (
        <CharacterGeneratedFieldPreview
          field={field}
          value={preview}
          onApply={(value) => {
            onApply(value);
            setPreview(null);
            toast.success(`${label} applied.`);
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function CharacterGeneratedFieldPreview({
  field,
  value,
  onApply,
  onClose,
}: {
  field: CharacterFieldGenerationField;
  value: CharacterFieldGenerationValue;
  onApply: (value: CharacterFieldGenerationValue) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CharacterFieldGenerationValue>(value);
  const label = CHARACTER_FIELD_LABELS[field];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 max-md:pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[84vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">Generated {label}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--accent)]">
            <X size="1rem" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isDepthPrompt(draft) ? (
            <div className="space-y-3">
              <textarea
                value={draft.prompt}
                onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                rows={8}
                className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm outline-none focus:border-[var(--primary)]/40"
              />
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--muted-foreground)]">Depth</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.depth}
                    onChange={(event) =>
                      setDraft({ ...draft, depth: Math.max(0, Math.min(100, parseInt(event.target.value, 10) || 0)) })
                    }
                    className="w-16 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-center text-xs outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--muted-foreground)]">Role</span>
                  <select
                    value={draft.role}
                    onChange={(event) => setDraft({ ...draft, role: event.target.value as DepthPrompt["role"] })}
                    className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none"
                  >
                    <option value="system">System</option>
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </select>
                </label>
              </div>
            </div>
          ) : Array.isArray(draft) ? (
            <textarea
              value={draft.join(", ")}
              onChange={(event) =>
                setDraft(
                  event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
              rows={5}
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm outline-none focus:border-[var(--primary)]/40"
            />
          ) : (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={14}
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none focus:border-[var(--primary)]/40"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-1.5 text-xs font-medium hover:bg-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-xl bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm hover:opacity-90 active:scale-[0.98]"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
