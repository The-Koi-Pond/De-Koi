import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ArrowUpDown, Check, Download, Minus, Plus, Search, Sparkles, Tag, X } from "lucide-react";

import { cn } from "../../../shared/lib/utils";
import { countTagFilters, type TagFilterMode, type TagFilters } from "../lib/tag-filters";

/*
 * The shared top of a library panel (Characters, Personas, and the others as
 * they get the same layout), plus the stacked buttons on a list row. The
 * strips touch the panel's edges; the filters are pills. DESIGN.md section 7
 * ("Navigation") describes the layout.
 */

/** The panel's colour: koi for Characters, jade for Personas (as on the Characters | Personas switch), amber for Lorebooks. */
export type CatalogPanelTone = "koi" | "jade" | "amber";

const STRIP_CELL =
  "flex min-w-0 items-center justify-center gap-1 px-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]";
const PLAIN_STRIP_CELL = "border-l border-[var(--border)]/60 text-[var(--foreground)] hover:bg-[var(--accent)]";
const TONE = {
  // The gradients are the panels' old button colours; the Pond theme maps them to its own koi and jade.
  koi: {
    create: "bg-gradient-to-r from-pink-400 to-purple-500",
    selected: "bg-[var(--primary)]/12 text-[var(--primary)]",
    activePill: "border-[var(--primary)]/40 bg-[var(--primary)]/12 text-[var(--primary)]",
    includedChip: "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30",
  },
  jade: {
    create: "bg-gradient-to-r from-emerald-400 to-teal-500",
    selected: "bg-emerald-400/12 text-emerald-400",
    activePill: "border-emerald-400/40 bg-emerald-400/12 text-emerald-400",
    includedChip: "bg-emerald-400/15 text-emerald-400 ring-1 ring-emerald-400/30",
  },
  amber: {
    create: "bg-gradient-to-r from-amber-400 to-orange-500",
    selected: "bg-amber-400/12 text-amber-400",
    activePill: "border-amber-400/40 bg-amber-400/12 text-amber-400",
    includedChip: "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30",
  },
} as const;

/** One more plain cell in the action strip, before Select (the chat list's Folder). */
export type CatalogStripAction = {
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

const STRIP_GRID_COLUMNS = ["grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5"] as const;

/**
 * New / Import / Maker / Select: joined cells in one strip across the top of the panel.
 * Without `onOpenMaker` (a library with no AI Maker) the strip has three cells; without
 * `onImport` (the chat list) there's no Import cell, and `extraAction` adds a cell before Select.
 */
export function CatalogActionBar({
  tone,
  selectionMode,
  onCreate,
  createLabel = "New",
  createTitle = createLabel,
  createIcon,
  onImport,
  onOpenMaker,
  extraAction,
  onToggleSelectionMode,
  selectDisabled,
}: {
  tone: CatalogPanelTone;
  selectionMode: boolean;
  onCreate: () => void;
  /** The New cell's words ("New chat"), its tooltip and its icon (a plus by default). */
  createLabel?: string;
  createTitle?: string;
  createIcon?: ReactNode;
  onImport?: () => void;
  onOpenMaker?: () => void;
  extraAction?: CatalogStripAction;
  onToggleSelectionMode: () => void;
  selectDisabled?: boolean;
}) {
  const cellCount = 2 + (onImport ? 1 : 0) + (onOpenMaker ? 1 : 0) + (extraAction ? 1 : 0);
  return (
    <div className={cn("grid h-10 border-b border-[var(--border)]/60", STRIP_GRID_COLUMNS[cellCount - 2])}>
      <button
        type="button"
        onClick={onCreate}
        className={cn(STRIP_CELL, TONE[tone].create, "text-white hover:brightness-110")}
        title={createTitle}
      >
        {createIcon ?? <Plus size="0.8125rem" className="shrink-0" aria-hidden="true" />}{" "}
        <span className="truncate">{createLabel}</span>
      </button>
      {onImport && (
        <button type="button" onClick={onImport} className={cn(STRIP_CELL, PLAIN_STRIP_CELL)} title="Import">
          <Download size="0.8125rem" className="shrink-0" aria-hidden="true" /> <span className="truncate">Import</span>
        </button>
      )}
      {onOpenMaker && (
        <button type="button" onClick={onOpenMaker} className={cn(STRIP_CELL, PLAIN_STRIP_CELL)} title="AI Maker">
          <Sparkles size="0.8125rem" className="shrink-0" aria-hidden="true" /> <span className="truncate">Maker</span>
        </button>
      )}
      {extraAction && (
        <button
          type="button"
          onClick={extraAction.onClick}
          disabled={extraAction.disabled}
          className={cn(STRIP_CELL, PLAIN_STRIP_CELL, "disabled:cursor-wait disabled:opacity-60")}
          title={extraAction.title}
        >
          {extraAction.icon} <span className="truncate">{extraAction.label}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onToggleSelectionMode}
        disabled={selectDisabled}
        className={cn(
          STRIP_CELL,
          "border-l border-[var(--border)]/60",
          selectDisabled !== undefined && "disabled:opacity-40",
          selectionMode ? TONE[tone].selected : "text-[var(--foreground)] hover:bg-[var(--accent)]",
        )}
        aria-pressed={selectionMode}
        title="Select"
      >
        <Check size="0.8125rem" className="shrink-0" aria-hidden="true" />
        <span className="truncate">Select</span>
      </button>
    </div>
  );
}

type CatalogSortOption<TSort extends string> = { value: TSort; label: string; short?: string };

/** The search strip's sort box: all three together, or none (a list with one order, search only). */
type CatalogSearchSortProps<TSort extends string> =
  | {
      sort: TSort;
      /** `short`: what the bar shows for that order when its full `label` is long (the list shows `label`). */
      sortOptions: ReadonlyArray<CatalogSortOption<TSort>>;
      onSortChange: (value: TSort) => void;
    }
  | { sort?: undefined; sortOptions?: undefined; onSortChange?: undefined };

/** Search joined to its sort box (when the list has one): one strip, edge to edge across the panel. */
export function CatalogSearchStrip<TSort extends string = string>({
  search,
  onSearchChange,
  placeholder,
  hint,
  sort,
  sortOptions,
  onSortChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  /** Shown as the search box's tooltip, e.g. search tricks. */
  hint?: string;
} & CatalogSearchSortProps<TSort>) {
  return (
    <div className="flex h-10 border-b border-[var(--border)]/60">
      <label className="relative flex min-w-0 flex-1 items-center">
        <Search
          size="0.8125rem"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
        />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          title={hint}
          className="h-full w-full bg-transparent pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)]/60 focus:bg-[var(--accent)]/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
        />
      </label>
      {sort !== undefined && sortOptions && onSortChange && (
        <CatalogSortBox sort={sort} sortOptions={sortOptions} onSortChange={onSortChange} />
      )}
    </div>
  );
}

function CatalogSortBox<TSort extends string>({
  sort,
  sortOptions,
  onSortChange,
}: {
  sort: TSort;
  sortOptions: ReadonlyArray<CatalogSortOption<TSort>>;
  onSortChange: (value: TSort) => void;
}) {
  const selectedSort = sortOptions.find((option) => option.value === sort) ?? sortOptions[0];
  // The bar shows a short name for the chosen order ("Budget"); the real drop-down lies invisibly on
  // top, so clicking, the keyboard and screen readers use it, and its list shows the full names.
  return (
    <label
      className="relative flex items-center gap-1.5 border-l border-[var(--border)]/60 pl-3 pr-2.5 text-[0.6875rem] transition-colors hover:bg-[var(--accent)] has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-inset has-[select:focus-visible]:ring-[var(--ring)]"
      title="Sort order"
    >
      <span aria-hidden="true">{selectedSort?.short ?? selectedSort?.label}</span>
      <ArrowUpDown size="0.625rem" aria-hidden="true" className="text-[var(--muted-foreground)]" />
      <select
        value={sort}
        onChange={(event) => onSortChange(event.target.value as TSort)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        aria-label="Sort order"
      >
        {/* The invisible drop-down has no colours of its own, so its open list gets the app's menu colours. */}
        {sortOptions.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="bg-[var(--popover)] text-[var(--popover-foreground)]"
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The row of filter pills under the search (filters read as tokens you toggle). */
export function CatalogFilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** One filter pill. `pressed` is a toggle filter's state; `expanded` a pill that opens a list (Tags). */
export function CatalogFilterPill({
  tone = "koi",
  active,
  pressed,
  expanded,
  title,
  onClick,
  children,
}: {
  tone?: CatalogPanelTone;
  active: boolean;
  pressed?: boolean;
  expanded?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={title}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.625rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        active
          ? TONE[tone].activePill
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A tag in a tag filter list. Clicking cycles it off → include → exclude → off (see `cycleTagFilter`):
 * included shows in the panel's colour, excluded in red with a "−". `onDelete` adds an × that deletes
 * the tag everywhere.
 */
export function TagFilterChip({
  tag,
  mode,
  tone = "koi",
  noun = "Tag",
  onCycle,
  onDelete,
}: {
  tag: string;
  mode: TagFilterMode | undefined;
  tone?: CatalogPanelTone;
  /** What the chip is, for screen readers ("Tag", "Type"). Only tags show the little tag icon. */
  noun?: "Tag" | "Type";
  onCycle: () => void;
  onDelete?: () => void;
}) {
  const state = mode === "include" ? "showing only these" : mode === "exclude" ? "hiding these" : "off";
  return (
    <span
      className={cn(
        "flex items-center rounded-full text-[0.625rem] font-medium transition-colors",
        mode === "include"
          ? TONE[tone].includedChip
          : mode === "exclude"
            ? "bg-[var(--destructive)]/12 text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
      )}
    >
      <button
        type="button"
        onClick={onCycle}
        aria-label={`${noun} ${tag}: ${state}. Click to ${mode === undefined ? "show only these" : mode === "include" ? "hide these" : "turn off"}.`}
        title="Click: show only these → hide these → off"
        className={cn(
          "flex items-center gap-1 rounded-full py-0.5 pl-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          onDelete ? "pr-1" : "pr-2",
        )}
      >
        {mode === "exclude" ? (
          <Minus size="0.5625rem" className="shrink-0" aria-hidden="true" />
        ) : (
          noun === "Tag" && <Tag size="0.5rem" className="shrink-0" aria-hidden="true" />
        )}
        <span className={cn(mode === "exclude" && "line-through decoration-1")}>{tag}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete tag ${tag}`}
          title={`Delete tag "${tag}"`}
          className="mr-1 rounded-full p-0.5 transition-colors hover:bg-[var(--destructive)]/20 hover:text-[var(--destructive)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <X size="0.5rem" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** Turns every tag filter off. */
export function TagFilterClear({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="flex items-center gap-1 rounded-full bg-[var(--destructive)]/10 px-2 py-0.5 text-[0.625rem] font-medium text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <X size="0.5rem" aria-hidden="true" /> Clear
    </button>
  );
}

/** "+2 · −1": how many tags are included and excluded, for a Tags button's label. */
export function tagFilterSummary(filters: TagFilters): string | null {
  const { included, excluded } = countTagFilters(filters);
  const parts = [included > 0 ? `+${included}` : null, excluded > 0 ? `−${excluded}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type CatalogRowAction = {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  /** Text and hover colours for the cell. */
  className: string;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  hasPopup?: "menu";
};

// Each stacked button gets at least 1.5rem (24px) of the row's height, so it stays easy to hit.
const ROW_ACTION_MIN_REM = 1.5;

/**
 * Props for a list row that shows `CatalogRowActions`: on desktop the row grows just
 * enough for its stacked buttons. Spread onto the row and add `className` to its classes.
 */
export function catalogRowActionsRowProps(actionCount: number): { style: CSSProperties; className: string } {
  return {
    style: { "--catalog-row-min-height": `${actionCount * ROW_ACTION_MIN_REM}rem` } as CSSProperties,
    className: "md:min-h-[var(--catalog-row-min-height)]",
  };
}

/**
 * A row's hover buttons: a column of joined cells stacked down the row's right edge, sharing its
 * height equally; shown on hover or keyboard focus. Phones, where they always show, keep them side
 * by side. Touch screens without hover always show them too (`data-de-koi-action-group`, see
 * 07-responsive-accessibility.css). The row needs `group relative` and the `catalogRowActionsRowProps` height.
 */
export function CatalogRowActions({ actions }: { actions: CatalogRowAction[] }) {
  return (
    <div
      data-de-koi-action-group="catalog-row"
      className="absolute inset-y-0 right-0 flex w-9 flex-col overflow-hidden rounded-r-xl border-l border-[var(--border)]/60 bg-[var(--sidebar)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:static max-md:w-auto max-md:flex-row max-md:rounded-xl max-md:border max-md:opacity-100"
    >
      {actions.map((action, index) => (
        <button
          key={action.key}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            action.onClick(event);
          }}
          className={cn(
            "flex min-h-0 flex-1 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] max-md:h-9 max-md:w-9 max-md:flex-none",
            index > 0 && "border-t border-[var(--border)]/60 max-md:border-l max-md:border-t-0",
            action.className,
          )}
          title={action.title}
          aria-label={action.label}
          aria-haspopup={action.hasPopup}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}
