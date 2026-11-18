import { Check, Minus, X } from "lucide-react";
import { useMemo } from "react";

import { cn } from "../../../../../shared/lib/utils";

export interface TagPanelProps {
  tags: string[];
  includeTags: string[];
  excludeTags: string[];
  tagSearch: string;
  onTagSearchChange: (value: string) => void;
  onInclude: (tag: string) => void;
  onExclude: (tag: string) => void;
  onRemove: (tag: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** The side panel for tag filters: a search that can add any typed tag, the tags in use, and every tag seen. */
export function TagPanel({
  tags,
  includeTags,
  excludeTags,
  tagSearch,
  onTagSearchChange,
  onInclude,
  onExclude,
  onRemove,
  onClear,
  onClose,
}: TagPanelProps) {
  const typed = tagSearch.trim().toLowerCase();
  const offerTyped = typed.length >= 2 && !includeTags.includes(typed);
  const inUse = includeTags.length + excludeTags.length > 0;
  const visibleTags = useMemo(() => {
    const filter = tagSearch.trim().toLowerCase();
    return filter ? tags.filter((tag) => tag.toLowerCase().includes(filter)) : tags;
  }, [tagSearch, tags]);

  const addTyped = (exclude: boolean) => {
    if (exclude) onExclude(typed);
    else onInclude(typed);
    onTagSearchChange("");
  };

  return (
    <aside
      aria-label="Tags"
      className="flex w-[260px] max-w-[85vw] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--card)]"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <h2 className="flex-1 text-sm font-semibold text-[var(--foreground)]">Tags</h2>
        {inUse && (
          <button
            type="button"
            onClick={onClear}
            className="rounded px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          aria-label="Close tags"
          onClick={onClose}
          className="de-koi-icon-target rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <X size="0.875rem" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-2 border-b border-[var(--border)] p-3">
        <input
          type="search"
          value={tagSearch}
          onChange={(event) => onTagSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && offerTyped) {
              event.preventDefault();
              addTyped(false);
            }
          }}
          placeholder="Search tags..."
          aria-label="Search tags"
          className="h-8 w-full rounded-md border border-[var(--input)] bg-[var(--secondary)] px-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        {offerTyped && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => addTyped(false)}
              className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-emerald-500 hover:bg-[var(--accent)]"
            >
              + Add {typed} as filter
            </button>
            <button
              type="button"
              onClick={() => addTyped(true)}
              className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--destructive)] hover:bg-[var(--accent)]"
            >
              − Block {typed} from results
            </button>
          </div>
        )}
        {inUse && (
          <ul aria-label="Tags in use" className="flex flex-wrap gap-1">
            {includeTags.map((tag) => (
              <li key={`include-${tag}`}>
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => onRemove(tag)}
                  className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500 hover:bg-emerald-500/20"
                >
                  + {tag}
                </button>
              </li>
            ))}
            {excludeTags.map((tag) => (
              <li key={`exclude-${tag}`}>
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => onRemove(tag)}
                  className="rounded-full border border-[var(--destructive)]/50 bg-[var(--destructive)]/10 px-2 py-0.5 text-xs text-[var(--destructive)] hover:bg-[var(--destructive)]/20"
                >
                  − {tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {visibleTags.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-[var(--muted-foreground)]">
            {tags.length === 0 ? "Tags will appear after searching" : "No tags match filter"}
          </p>
        ) : (
          <ul>
            {visibleTags.map((tag) => {
              const included = includeTags.includes(tag);
              const excluded = excludeTags.includes(tag);
              return (
                <li key={tag} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--accent)]">
                  <button
                    type="button"
                    aria-label={`Include ${tag}`}
                    aria-pressed={included}
                    onClick={() => (included ? onRemove(tag) : onInclude(tag))}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      included
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-500"
                        : "border-[var(--border)] text-transparent",
                    )}
                  >
                    <Check size="0.75rem" aria-hidden="true" />
                  </button>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs text-[var(--foreground)]",
                      excluded && "text-[var(--muted-foreground)] line-through",
                    )}
                  >
                    {tag}
                  </span>
                  <button
                    type="button"
                    aria-label={`Exclude ${tag}`}
                    aria-pressed={excluded}
                    onClick={() => (excluded ? onRemove(tag) : onExclude(tag))}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      excluded
                        ? "border-[var(--destructive)] bg-[var(--destructive)]/20 text-[var(--destructive)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)]",
                    )}
                  >
                    <Minus size="0.75rem" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
