import { BookOpen } from "lucide-react";
import { SUPPORTED_MACROS, type SupportedMacroDefinition } from "../../../../../engine/shared/macros/macro-engine";
import { DialogShell } from "./dialog-shell";

/** `SUPPORTED_MACROS` by category, in first-seen order. */
const CATEGORIES = SUPPORTED_MACROS.reduce<Array<[string, SupportedMacroDefinition[]]>>((categories, macro) => {
  const found = categories.find(([category]) => category === macro.category);
  if (found) found[1].push(macro);
  else categories.push([macro.category, [macro]]);
  return categories;
}, []);

/** The macros reference (docs/provenance/preset-sections.md, "Macros reference"). */
export function MacrosReferenceDialog({ onClose }: { onClose: () => void }) {
  return (
    <DialogShell
      title="Macros Reference"
      icon={<BookOpen size="1rem" className="text-purple-400" />}
      onClose={onClose}
      panelClassName="max-h-[80vh] max-w-lg"
      footer={
        <div className="border-t border-[var(--border)] px-4 py-2.5 text-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Use these macros in your prompt sections. They will be replaced with actual values at generation time.
        </p>
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          In group chats, a bracketed block containing character macros like <code>{"{{char}}"}</code> and{" "}
          <code>{"{{description}}"}</code> repeats once per character.
        </p>
        {CATEGORIES.map(([category, macros]) => (
          <div key={category}>
            <h4 className="mb-1.5 text-[0.6875rem] font-semibold text-purple-400">{category}</h4>
            <div className="space-y-1">
              {macros.map((macro) => (
                <div
                  key={macro.syntax}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--accent)]"
                >
                  <code className="shrink-0 rounded bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[0.625rem] font-medium text-amber-400">
                    {macro.syntax}
                  </code>
                  <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{macro.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
