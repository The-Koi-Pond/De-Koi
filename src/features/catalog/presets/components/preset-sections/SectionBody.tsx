import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { PromptGroup } from "../../../../../engine/contracts/types/prompt";
import { DraftNumberInput } from "../../../../../shared/components/ui/DraftNumberInput";
import { ContentEditor } from "./ContentEditor";
import { agentMacro, LOREBOOK_MARKER_TYPES, markerLabel, type SectionRow, type SectionView } from "./section-row";

const FIELD =
  "rounded-lg bg-[var(--secondary)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]";
/** The dropdowns and the depth box keep their border ring when focused. */
const SELECT = "rounded-lg bg-[var(--secondary)] ring-1 ring-[var(--border)]";
const LABEL = "text-[var(--muted-foreground)]";

/**
 * The name input: selects its text on focus; on blur (and on Enter, which then blurs, so Enter saves twice as
 * recorded) it saves the trimmed text when it isn't empty and differs from the stored name, else puts the stored
 * name back. A new stored name replaces the text, even while typing.
 */
function NameInput({ stored, onSave }: { stored: unknown; onSave: (name: string) => void }) {
  // As stored: a row without a name keeps `undefined`, and leaving the input then throws (follow-up 9).
  const [text, setText] = useState(stored as string);
  useEffect(() => setText(stored as string), [stored]);

  const save = () => {
    const name = text.trim();
    if (name && name !== stored) onSave(name);
    else setText(stored as string);
  };

  return (
    <input
      type="text"
      aria-label="Section name"
      value={text}
      placeholder="Section name"
      onFocus={(event) => event.target.select()}
      onChange={(event) => setText(event.target.value)}
      onBlur={save}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        save();
        event.currentTarget.blur();
      }}
      className={`flex-1 px-2.5 py-1.5 text-xs ${FIELD}`}
    />
  );
}

/** A card's expanded body (docs/provenance/preset-sections.md, "Expanded body"). */
export function SectionBody({
  section,
  view,
  groupMap,
  update,
}: {
  section: SectionRow;
  view: SectionView;
  groupMap: Map<string, PromptGroup>;
  /** `onUpdateSection.mutate` with the preset and section filled in. */
  update: (data: Record<string, unknown>) => void;
}) {
  const positionId = useId();
  const groupId = useId();
  const config = view.marker ? view.config : null;
  // As stored: `null`, missing or non-text content stays as it is as recorded.
  const content = section.content;
  const saveContent = (text: string) => update({ content: text });

  return (
    <div className="space-y-3 border-t border-[var(--border)] p-3">
      <div className="flex gap-2">
        <NameInput stored={section.name} onSave={(name) => update({ name })} />
        <select
          aria-label="Role"
          value={(section.role as string | null | undefined) ?? "system"}
          onChange={(event) => update({ role: event.target.value })}
          className={`px-2 py-1.5 text-xs focus:outline-none ${SELECT}`}
        >
          <option value="system">System</option>
          <option value="user">User</option>
          <option value="assistant">Assistant</option>
        </select>
      </div>

      {!view.marker && <ContentEditor stored={content} name={section.name} onSave={saveContent} />}

      {config?.type === "agent_data" && (
        <div>
          <div className="mb-2 rounded-lg bg-[var(--primary)]/5 p-3 text-xs text-[var(--primary)]">
            Agent section: <strong>{section.name as string}</strong>
            <p className="mt-1 text-[var(--muted-foreground)]">
              The{" "}
              <code className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.625rem] text-pink-300">
                {agentMacro(config)}
              </code>{" "}
              macro will be replaced with the latest output from the agent at assembly time. You can add additional
              instructions around it.
            </p>
          </div>
          <ContentEditor stored={(content as string) || agentMacro(config)} name={section.name} onSave={saveContent} />
        </div>
      )}

      {config && config.type !== "agent_data" && (
        <div className="rounded-lg bg-violet-400/5 p-3 text-xs text-violet-300">
          Marker type: <strong>{markerLabel(config.type)}</strong>
          <p className="mt-1 text-[var(--muted-foreground)]">
            Content is auto-generated at assembly time from your characters, lorebooks, etc.
          </p>
          {LOREBOOK_MARKER_TYPES.includes(config.type) && (
            <p className="mt-1 text-amber-200">This is where active lorebook entries are inserted.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label htmlFor={positionId} className={LABEL}>
          Position:
        </label>
        <select
          id={positionId}
          value={(section.injectionPosition as string | undefined) ?? "ordered"}
          onChange={(event) => update({ injectionPosition: event.target.value })}
          className={`px-2 py-1 ${SELECT}`}
        >
          <option value="ordered">Ordered (in sequence)</option>
          <option value="depth">Depth (from end of chat)</option>
        </select>
        {section.injectionPosition === "depth" && (
          <>
            {/* `contents` keeps the label out of the layout; it only ties "Depth:" to the box. */}
            <label className="contents">
              <span className={LABEL}>Depth:</span>
              <DraftNumberInput
                value={(section.injectionDepth as number | undefined) ?? 0}
                min={0}
                selectOnFocus
                onCommit={(injectionDepth) => update({ injectionDepth })}
                className={`w-16 px-2 py-1 ${SELECT}`}
              />
            </label>
            <span className={LABEL}>(0 = after last message)</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <label htmlFor={groupId} className={LABEL}>
          Group:
        </label>
        <select
          id={groupId}
          value={(section.groupId as string | null | undefined) ?? ""}
          onChange={(event) => update({ groupId: event.target.value || null })}
          className={`px-2 py-1 ${SELECT}`}
        >
          <option value="">No group</option>
          {[...groupMap.values()].map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        {groupMap.size === 0 && <span className={LABEL}>(open Groups panel to create one)</span>}
      </div>
    </div>
  );
}
