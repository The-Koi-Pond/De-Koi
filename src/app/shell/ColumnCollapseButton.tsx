import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The fold-away tab of the Pond rail's column: a small half-pill attached to
 * the column's left edge (styles: `.de-koi-column-tab`). In a column header,
 * "‹" folds the whole column away (chat list, Deki-senpai's list or a panel
 * like Characters). Once folded, a "›" one stays at the rail's edge and brings
 * back what was there.
 */
export function ColumnCollapseButton({
  onCollapse,
  direction = "fold",
}: {
  onCollapse: () => void;
  direction?: "fold" | "unfold";
}) {
  const fold = direction === "fold";
  const Chevron = fold ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onCollapse}
      className="de-koi-column-tab"
      title={fold ? "Fold away" : "Open the side column"}
      aria-label={fold ? "Fold the side column away" : "Open the side column"}
      aria-expanded={fold}
    >
      <Chevron size="0.75rem" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
