import type { LibraryFolder } from "../../../engine/contracts/types/library-folder";
import { cn } from "../../../shared/lib/utils";

type LibraryFolderSelectProps = {
  value?: string | null;
  folders: Array<Pick<LibraryFolder, "id" | "name">>;
  itemLabel: string;
  disabled?: boolean;
  className?: string;
  onChange: (folderId: string | null) => void;
};

export function LibraryFolderSelect({
  value,
  folders,
  itemLabel,
  disabled,
  className,
  onChange,
}: LibraryFolderSelectProps) {
  if (folders.length === 0) return null;

  const normalizedValue = value && folders.some((folder) => folder.id === value) ? value : "";

  return (
    <select
      value={normalizedValue}
      disabled={disabled}
      aria-label={`Move ${itemLabel} to folder`}
      title="Move to folder"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        const nextFolderId = event.target.value || null;
        if ((normalizedValue || null) === nextFolderId) return;
        onChange(nextFolderId);
      }}
      className={cn(
        "h-7 max-w-[8rem] rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 text-[0.625rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 disabled:opacity-50",
        className,
      )}
    >
      <option value="">Unfiled</option>
      {folders.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {folder.name}
        </option>
      ))}
    </select>
  );
}
