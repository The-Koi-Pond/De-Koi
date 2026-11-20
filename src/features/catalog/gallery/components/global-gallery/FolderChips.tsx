import { Fragment, type DragEvent, type ReactNode } from "react";
import { Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import type { GalleryFolder } from "../../hooks/use-global-gallery";
import { ALL_IMAGES, folderFilter, sameFilter, UNFILED, type ChipCounts, type GalleryFilter } from "./gallery-view";

interface DropHandlers {
  onDragOver: (target: GalleryFilter) => boolean;
  onDragLeave: (target: GalleryFilter) => void;
  onDrop: (target: GalleryFilter, imageId: string) => void;
}

interface FolderChipsProps extends DropHandlers {
  folders: readonly GalleryFolder[];
  counts: ChipCounts;
  selected: GalleryFilter;
  dropTarget: GalleryFilter | null;
  onSelect: (filter: GalleryFilter) => void;
  onNewFolder: () => void;
}

export function FolderChips({
  folders,
  counts,
  selected,
  dropTarget,
  onSelect,
  onNewFolder,
  ...drop
}: FolderChipsProps) {
  const chip = (filter: GalleryFilter, label: string, count: number, icon?: ReactNode, droppable = true) => (
    <Chip
      filter={filter}
      label={label}
      count={count}
      icon={icon}
      selected={sameFilter(selected, filter)}
      ringed={dropTarget !== null && sameFilter(dropTarget, filter)}
      onSelect={onSelect}
      drop={droppable ? drop : undefined}
    />
  );

  return (
    <div className="flex flex-wrap gap-1.5">
      {chip(ALL_IMAGES, "All", counts.all, undefined, false)}
      {chip(UNFILED, "Unfiled", counts.unfiled)}
      {folders.map((folder) => (
        <Fragment key={folder.id}>
          {chip(
            folderFilter(folder.id),
            folder.name,
            counts.byFolder.get(folder.id) ?? 0,
            <Folder size="0.75rem" className="shrink-0" />,
          )}
        </Fragment>
      ))}
      <button
        type="button"
        onClick={onNewFolder}
        aria-label="New folder"
        title="New folder"
        className="flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
      >
        <FolderPlus size="0.75rem" className="shrink-0" />
        New
      </button>
    </div>
  );
}

function Chip({
  filter,
  label,
  count,
  icon,
  selected,
  ringed,
  onSelect,
  drop,
}: {
  filter: GalleryFilter;
  label: string;
  count: number;
  icon?: ReactNode;
  selected: boolean;
  ringed: boolean;
  onSelect: (filter: GalleryFilter) => void;
  drop?: DropHandlers;
}) {
  const dropProps = drop && {
    onDragOver: (event: DragEvent<HTMLButtonElement>) => {
      if (!drop.onDragOver(filter)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDragLeave: () => drop.onDragLeave(filter),
    onDrop: (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      drop.onDrop(filter, event.dataTransfer.getData("text/plain"));
    },
  };

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(filter)}
      {...dropProps}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
        selected
          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        ringed && "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)]",
      )}
    >
      {icon}
      <span className="max-w-[7rem] truncate">{label}</span>
      <span className="text-[0.625rem] opacity-70">{count}</span>
    </button>
  );
}

export function FolderBar({ name, onRename, onDelete }: { name: string; onRename: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)]/60 px-3 py-1.5">
      <Folder size="0.8125rem" className="shrink-0 text-[var(--primary)]" />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{name}</span>
      <button
        type="button"
        onClick={onRename}
        aria-label="Rename folder"
        title="Rename folder"
        className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
      >
        <Pencil size="0.75rem" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete folder"
        title="Delete folder"
        className="rounded-md p-1 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
      >
        <Trash2 size="0.75rem" />
      </button>
    </div>
  );
}
