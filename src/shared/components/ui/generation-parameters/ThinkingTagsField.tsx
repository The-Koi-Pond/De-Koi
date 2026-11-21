import { Plus, Trash2 } from "lucide-react";
import type { CustomThinkingTagPair } from "../../../../engine/contracts/types/prompt";
import { FieldLabel, LINE_FIELD_CLASS } from "./field-parts";
import { MAX_CUSTOM_THINKING_TAGS } from "./parameters";

const HELP =
  "Optional open/close wrappers that should be stripped from streamed output and saved as thinking metadata.";

/** The first of `<analysis>`, `<analysis2>` … `<analysis20>` no row opens with yet. */
function nextTag(tags: readonly CustomThinkingTagPair[]): CustomThinkingTagPair {
  const used = new Set(tags.map((tag) => tag.open));
  for (let n = 1; n <= MAX_CUSTOM_THINKING_TAGS; n++) {
    const name = n === 1 ? "analysis" : `analysis${n}`;
    if (!used.has(`<${name}>`)) return { open: `<${name}>`, close: `</${name}>` };
  }
  return { open: "<custom-thinking>", close: "</custom-thinking>" };
}

interface ThinkingTagsFieldProps {
  tags: CustomThinkingTagPair[];
  onChange: (next: CustomThinkingTagPair[]) => void;
}

export function ThinkingTagsField({ tags, onChange }: ThinkingTagsFieldProps) {
  const full = tags.length >= MAX_CUSTOM_THINKING_TAGS;
  const edit = (index: number, side: keyof CustomThinkingTagPair, text: string) =>
    onChange(tags.map((tag, i) => (i === index ? { ...tag, [side]: text } : tag)));

  return (
    <div>
      <FieldLabel label="Custom Thinking Tags" help={HELP} />
      <div className="mt-1 space-y-1.5">
        {tags.map((tag, index) => {
          const n = index + 1;
          return (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-1.5">
              <input
                type="text"
                aria-label={`Custom thinking tag ${n} open`}
                value={tag.open}
                placeholder="<analysis>"
                onChange={(event) => edit(index, "open", event.target.value)}
                className={`${LINE_FIELD_CLASS} font-mono`}
              />
              <input
                type="text"
                aria-label={`Custom thinking tag ${n} close`}
                value={tag.close}
                placeholder="</analysis>"
                onChange={(event) => edit(index, "close", event.target.value)}
                className={`${LINE_FIELD_CLASS} font-mono`}
              />
              <button
                type="button"
                aria-label={`Remove custom thinking tag ${n}`}
                onClick={() => onChange(tags.filter((_, i) => i !== index))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
              >
                <Trash2 size="0.875rem" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={full}
          onClick={() => {
            if (!full) onChange([...tags, nextTag(tags)]);
          }}
          className="flex items-center gap-1 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-[0.625rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors enabled:hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size="0.75rem" />
          Add tag
        </button>
      </div>
    </div>
  );
}
