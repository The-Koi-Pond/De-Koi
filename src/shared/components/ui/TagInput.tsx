import { useMemo, useState, type ReactNode } from "react";
import { Tag, X } from "lucide-react";

import { cn } from "../../lib/utils";

type TagTone = "primary" | "emerald" | "amber";

const toneClasses: Record<
  TagTone,
  {
    chip: string;
    inputFocus: string;
    addButton: string;
    suggestionActive: string;
  }
> = {
  primary: {
    chip: "bg-[var(--primary)]/10 text-[var(--primary)]",
    inputFocus: "focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20",
    addButton:
      "bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/25 focus-visible:ring-[var(--primary)]/30",
    suggestionActive: "hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]",
  },
  emerald: {
    chip: "bg-emerald-400/10 text-emerald-400",
    inputFocus: "focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/20",
    addButton: "bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25 focus-visible:ring-emerald-400/30",
    suggestionActive: "hover:bg-emerald-400/10 hover:text-emerald-400",
  },
  amber: {
    chip: "bg-amber-400/15 text-amber-400",
    inputFocus: "focus:border-amber-400/40 focus:ring-1 focus:ring-amber-400/20",
    addButton: "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 focus-visible:ring-amber-400/30",
    suggestionActive: "hover:bg-amber-400/10 hover:text-amber-400",
  },
};

function normalizeTagInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function appendTags(tags: readonly string[], rawInput: string, separatorPattern: RegExp = /[,\n]/): string[] {
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  const nextTags = [...tags];
  for (const rawTag of rawInput.split(separatorPattern)) {
    const tag = normalizeTagInput(rawTag);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    nextTags.push(tag);
  }
  return nextTags;
}

function uniqueSuggestions(suggestions: readonly string[], tags: readonly string[], inputValue: string): string[] {
  const selected = new Set(tags.map((tag) => tag.toLowerCase()));
  const seen = new Set<string>();
  const query = normalizeTagInput(inputValue).toLowerCase();
  if (!query) return [];

  return suggestions
    .map(normalizeTagInput)
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (selected.has(key) || seen.has(key)) return false;
      if (!key.includes(query)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

export function TagInput({
  label,
  help,
  tags,
  inputValue,
  onInputChange,
  onTagsChange,
  suggestions = [],
  placeholder = "Add tag...",
  addButtonLabel = "Add",
  clearButtonLabel = "Remove All",
  inputAriaLabel,
  tone = "primary",
  toolbar,
  showClearAll = true,
  separatorPattern,
  className,
}: {
  label?: ReactNode;
  help?: ReactNode;
  tags: readonly string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  addButtonLabel?: ReactNode;
  clearButtonLabel?: ReactNode;
  inputAriaLabel?: string;
  tone?: TagTone;
  toolbar?: ReactNode;
  showClearAll?: boolean;
  separatorPattern?: RegExp;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const classes = toneClasses[tone];
  const matchingSuggestions = useMemo(
    () => uniqueSuggestions(suggestions, tags, inputValue),
    [inputValue, suggestions, tags],
  );
  const showSuggestions = focused && matchingSuggestions.length > 0;

  const addFromInput = () => {
    const nextTags = appendTags(tags, inputValue, separatorPattern);
    if (nextTags.length !== tags.length) onTagsChange(nextTags);
    onInputChange("");
  };

  const addSuggestion = (tag: string) => {
    const nextTags = appendTags(tags, tag, separatorPattern);
    if (nextTags.length !== tags.length) onTagsChange(nextTags);
    onInputChange("");
    setFocused(false);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {(label || toolbar || (showClearAll && tags.length > 0)) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              {label}
              {help}
            </span>
          )}
          <div className="flex items-center gap-1">
            {toolbar}
            {showClearAll && tags.length > 0 && (
              <button
                type="button"
                onClick={() => onTagsChange([])}
                className="rounded-lg px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
              >
                {clearButtonLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium",
                classes.chip,
              )}
            >
              <Tag size="0.625rem" />
              {tag}
              <button
                type="button"
                onClick={() => onTagsChange(tags.filter((current) => current !== tag))}
                className="ml-0.5 rounded-full transition-colors hover:text-[var(--destructive)]"
                aria-label={`Remove tag ${tag}`}
              >
                <X size="0.625rem" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative flex gap-1.5">
        <input
          value={inputValue}
          onInput={(event) => onInputChange(event.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (inputValue.trim()) addFromInput();
            }
          }}
          placeholder={placeholder}
          aria-label={inputAriaLabel}
          aria-autocomplete={suggestions.length > 0 ? "list" : undefined}
          aria-expanded={suggestions.length > 0 ? showSuggestions : undefined}
          className={cn(
            "min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none placeholder:text-[var(--muted-foreground)]/65",
            classes.inputFocus,
          )}
        />
        <button
          type="button"
          onClick={addFromInput}
          disabled={!inputValue.trim()}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45",
            classes.addButton,
          )}
          aria-label="Add tag"
        >
          {addButtonLabel}
        </button>
        {showSuggestions && (
          <div className="absolute left-0 right-12 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--popover)] p-1 shadow-xl">
            {matchingSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addSuggestion(tag)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors",
                  classes.suggestionActive,
                )}
              >
                <Tag size="0.625rem" />
                <span className="truncate">{tag}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
