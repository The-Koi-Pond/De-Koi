import { Code2, Hash, Type, type LucideIcon } from "lucide-react";
import type { FocusEvent, ReactNode } from "react";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { cn } from "../../../../../shared/lib/utils";
import type { PresetDraft } from "./preset-data";

// The Overview tab (docs/provenance/preset-overview.md, "Overview tab"): Name, Description, Wrap Format, Author and the
// two counts. Its parts are spaced by the content column, so it returns a fragment.

const FIELD =
  "w-full rounded-xl bg-[var(--secondary)] text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

const WRAP_FORMATS: ReadonlyArray<{ value: string; label: string; icon: LucideIcon }> = [
  { value: "xml", label: "XML", icon: Code2 },
  { value: "markdown", label: "MARKDOWN", icon: Hash },
  { value: "none", label: "NONE", icon: Type },
];

/** The line under the wrap buttons; any format but `xml` and `markdown` reads as no wrapping. */
function wrapNote(format: unknown): string {
  if (format === "xml") return "Sections wrapped in <xml_tags>. Groups become parent tags.";
  if (format === "markdown") return "Sections wrapped with ## Headings. Groups become # Headings.";
  return "No automatic wrapping. Section content is sent as-is.";
}

const selectAll = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => event.currentTarget.select();

/**
 * A labelled field. The label wraps no control (the inputs are named by `aria-label`), so like the recorded editor it
 * only lays out the text and the help icon.
 */
function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
        <HelpTooltip text={help} />
      </label>
      {children}
    </div>
  );
}

function StatCard({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-xl bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)]">
      <span className="text-xl font-bold text-[var(--foreground)]">{count}</span>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}

interface OverviewTabProps {
  draft: PresetDraft;
  onEdit: (patch: Partial<PresetDraft>) => void;
  sectionCount: number;
  groupCount: number;
}

export function OverviewTab({ draft, onEdit, sectionCount, groupCount }: OverviewTabProps) {
  return (
    <>
      <Field label="Name" help="The display name for this preset. Used in the Presets panel and chat settings.">
        {/* Unlike the header's name box, this one keeps the cursor where it is on focus. */}
        <input
          type="text"
          value={draft.name as string}
          onChange={(event) => onEdit({ name: event.target.value })}
          placeholder="Preset name…"
          aria-label="Name"
          className={cn(FIELD, "px-3 py-3")}
        />
      </Field>
      <Field
        label="Description"
        help="A short summary of what this preset is designed for. Helps you remember its purpose when choosing between presets."
      >
        <textarea
          value={draft.description as string}
          onChange={(event) => onEdit({ description: event.target.value })}
          onFocus={selectAll}
          placeholder="What does this preset do?"
          aria-label="Description"
          className={cn(FIELD, "min-h-[5rem] resize-y px-3 py-3")}
        />
      </Field>
      <Field
        label="Wrap Format"
        help="Controls how prompt sections are formatted when sent to the AI. XML uses <tags>, Markdown uses ## headings, None sends raw content."
      >
        <div className="flex gap-2">
          {WRAP_FORMATS.map(({ value, label, icon: Icon }) => {
            const active = draft.wrapFormat === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onEdit({ wrapFormat: value })}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium ring-1 transition-all",
                  active
                    ? "bg-purple-400/15 text-purple-400 ring-purple-400/30"
                    : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)]",
                )}
              >
                <Icon size="0.875rem" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">{wrapNote(draft.wrapFormat)}</p>
      </Field>
      <Field label="Author" help="Optional creator name, useful if you share presets with others.">
        <input
          type="text"
          value={draft.author as string}
          onChange={(event) => onEdit({ author: event.target.value })}
          onFocus={selectAll}
          placeholder="Your name (optional)"
          aria-label="Author"
          className={cn(FIELD, "px-2.5 py-2.5")}
        />
      </Field>
      <div className="flex gap-4">
        <StatCard count={sectionCount} label="Sections" />
        <StatCard count={groupCount} label="Groups" />
      </div>
    </>
  );
}
