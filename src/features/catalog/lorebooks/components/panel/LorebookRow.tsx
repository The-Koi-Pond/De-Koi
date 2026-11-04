import { useEffect, useState, type DragEvent } from "react";
import { BookOpen, Camera, Copy, Power, Trash2, UserRound } from "lucide-react";
import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";
import { resolveManagedLocalAssetThumbnailUrl } from "../../../../../shared/api/local-file-api";
import { cn } from "../../../../../shared/lib/utils";
import {
  CatalogRowActions,
  catalogRowActionsRowProps,
  type CatalogRowAction,
} from "../../../components/CatalogPanelControls";
import { LOREBOOK_CATEGORY_COLORS, LOREBOOK_PANEL_CATEGORIES } from "./lorebook-panel-config";
import { formatLorebookTokenBudget } from "./lorebook-panel-model";

export function LorebookRow({
  lorebook,
  characterName,
  personaName,
  onClick,
  onToggleEnabled,
  onDuplicate,
  onDelete,
  onImagePick,
  selectionMode,
  isSelected,
  onToggleSelect,
  draggable,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  lorebook: Lorebook;
  characterName?: string;
  personaName?: string;
  onClick: () => void;
  onToggleEnabled: () => void;
  onDuplicate: () => void;
  onDelete: () => void | Promise<void>;
  onImagePick: () => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}) {
  const gradient = LOREBOOK_CATEGORY_COLORS[lorebook.category] ?? LOREBOOK_CATEGORY_COLORS.uncategorized;
  const categoryMeta =
    LOREBOOK_PANEL_CATEGORIES.find((category) => category.id === (lorebook.category || "uncategorized")) ?? null;
  const CatIcon = categoryMeta?.icon ?? BookOpen;
  const typeLabel = categoryMeta?.label ?? "Other";
  const switchedOff = lorebook.enabled === false;
  const [resolvedImagePath, setResolvedImagePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedImagePath(null);
    if (!lorebook.imagePath) return;
    resolveManagedLocalAssetThumbnailUrl(lorebook.imagePath, 64)
      .then((url) => {
        if (!cancelled) setResolvedImagePath(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedImagePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lorebook.imagePath]);

  const imageContent = resolvedImagePath ? (
    <img src={resolvedImagePath} alt="" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <CatIcon size="1rem" />
  );
  const imageClasses = cn(
    "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-white shadow-sm",
    lorebook.imagePath ? "bg-[var(--muted)]" : `bg-gradient-to-br ${gradient}`,
    switchedOff && "grayscale",
  );
  // A switched-on lorebook's picture carries a small lit lantern: amber, softly glowing (Pond's "alive" sign).
  const lantern = !switchedOff && (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_6px_2px_rgba(251,191,36,0.55)] ring-2 ring-[var(--sidebar)]"
    />
  );

  // Type, then the budget, then who it's linked to, then the description: one truncated line.
  const linkedName = characterName ?? personaName;
  const budget =
    typeof lorebook.tokenBudget === "number" && lorebook.tokenBudget > 0
      ? ` · ~${formatLorebookTokenBudget(lorebook.tokenBudget)} budget`
      : "";
  const description = lorebook.description?.trim();
  const metaTail = description ? ` · ${description}` : !linkedName && !budget ? " · No description" : "";

  // Switch on/off, copy and delete, stacked down the row's right edge.
  const rowActions: CatalogRowAction[] = [
    {
      key: "toggle-enabled",
      title: switchedOff ? "Switch on" : "Switch off",
      label: `${switchedOff ? "Switch on" : "Switch off"} ${lorebook.name}`,
      icon: <Power size="0.75rem" aria-hidden="true" />,
      className: switchedOff
        ? "text-[var(--muted-foreground)] hover:bg-amber-400/10 hover:text-amber-400"
        : "text-amber-400 hover:bg-amber-400/10",
      onClick: onToggleEnabled,
    },
    {
      key: "duplicate",
      title: "Copy",
      label: `Copy ${lorebook.name}`,
      icon: <Copy size="0.75rem" aria-hidden="true" />,
      className: "text-[var(--muted-foreground)] hover:bg-sky-400/10 hover:text-sky-400",
      onClick: onDuplicate,
    },
    {
      key: "delete",
      title: "Delete",
      label: `Delete ${lorebook.name}`,
      icon: <Trash2 size="0.75rem" aria-hidden="true" />,
      className: "text-[var(--destructive)] hover:bg-[var(--destructive)]/15",
      onClick: () => void onDelete(),
    },
  ];
  const rowActionsProps = catalogRowActionsRowProps(rowActions.length);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={selectionMode ? undefined : rowActionsProps.style}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]",
        !selectionMode && rowActionsProps.className,
        // Switched off: dimmed (its picture also turns grey), clearer again while pointed at.
        switchedOff && "opacity-50 hover:opacity-90",
        selectionMode && isSelected && "ring-1 ring-amber-400/40 bg-amber-400/10",
        isDragging && "opacity-55 ring-1 ring-[var(--primary)]/30",
      )}
      onClick={onClick}
    >
      {selectionMode && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect?.();
          }}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
            isSelected
              ? "border-amber-400 bg-amber-400 text-white"
              : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)] text-transparent",
          )}
          aria-label={isSelected ? "Deselect lorebook" : "Select lorebook"}
        >
          <span className="text-[0.75rem]">✓</span>
        </button>
      )}
      <span className="relative shrink-0">
        {selectionMode ? (
          <div className={imageClasses}>{imageContent}</div>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onImagePick();
            }}
            className={cn(
              imageClasses,
              "group/pic transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-400/50",
            )}
            title={lorebook.imagePath ? "Replace lorebook picture" : "Upload lorebook picture"}
            aria-label={lorebook.imagePath ? "Replace lorebook picture" : "Upload lorebook picture"}
          >
            {imageContent}
            {/* The camera hint shows only while pointing at (or tabbing to) the picture itself. */}
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover/pic:opacity-100 group-focus-visible/pic:opacity-100">
              <Camera size="0.875rem" />
            </span>
          </button>
        )}
        {lantern}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{lorebook.name}</span>
          {/* On or off shows as the lit lantern dot and the dimming; screen readers hear it here. */}
          <span className="sr-only">{switchedOff ? ", switched off" : ", switched on"}</span>
        </div>
        <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
          {typeLabel}
          {budget}
          {linkedName && (
            <>
              {" · "}
              <UserRound size="0.625rem" className="inline shrink-0 align-[-0.0625rem]" aria-hidden="true" />{" "}
              {linkedName}
            </>
          )}
          {metaTail}
        </div>
      </div>
      {!selectionMode && <CatalogRowActions actions={rowActions} />}
    </div>
  );
}
