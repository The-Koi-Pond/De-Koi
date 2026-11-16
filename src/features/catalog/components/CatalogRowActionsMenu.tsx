import { useState, type ReactNode, type RefObject } from "react";
import { MoreVertical } from "lucide-react";

import { ContextMenu } from "../../../shared/components/ui/ContextMenu";

/**
 * Phones only: one "More actions" button in place of a row's side-by-side buttons. Each menu item clicks the
 * matching (hidden) row button, so it runs the same handler. Loaded on demand, outside the home bundle.
 */
/** What the menu shows for a row action; picking it clicks the row button at the same index. */
type RowMenuAction = { key: string; title: string; icon: ReactNode };

export function CatalogRowActionsMenu({
  actions,
  buttonRefs,
}: {
  actions: RowMenuAction[];
  buttonRefs: RefObject<Array<HTMLButtonElement | null>>;
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        title="More actions"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuAt({ x: rect.right, y: rect.bottom });
        }}
        className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)]/60 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-md:flex"
      >
        <MoreVertical size="0.875rem" aria-hidden="true" />
      </button>
      {menuAt && (
        // The menu is portalled, but React still bubbles its clicks and keys to the row (which would open it).
        <span
          className="contents"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ContextMenu
            x={menuAt.x}
            y={menuAt.y}
            onClose={() => setMenuAt(null)}
            items={actions.map((action, index) => ({
              label: action.title,
              icon: action.icon,
              destructive: action.key === "delete",
              onSelect: () => buttonRefs.current?.[index]?.click(),
            }))}
          />
        </span>
      )}
    </>
  );
}
