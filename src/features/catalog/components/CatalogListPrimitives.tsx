import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../../../shared/lib/utils";

type CatalogListStateProps = {
  state: "loading" | "empty" | "error";
  label: string;
  message?: string;
};

export function CatalogListState({ state, label, message }: CatalogListStateProps) {
  const text =
    message ??
    (state === "loading" ? `Loading ${label}...` : state === "empty" ? `No ${label} yet.` : `Could not load ${label}.`);

  return (
    <div
      data-catalog-list-state={state}
      className={cn(
        "rounded-lg px-3 py-3 text-center text-xs",
        state === "error"
          ? "border border-red-500/25 bg-red-500/10 text-red-300"
          : state === "empty"
            ? "border border-dashed border-[var(--border)] text-[var(--muted-foreground)]"
            : "text-[var(--muted-foreground)]",
      )}
    >
      {text}
    </div>
  );
}

type CatalogListRowProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  selected?: boolean;
  dragging?: boolean;
  disabled?: boolean;
  contextMenu?: "available" | "none";
};

export function CatalogListRow({
  children,
  selected = false,
  dragging = false,
  disabled = false,
  contextMenu = "none",
  className,
  ...props
}: CatalogListRowProps) {
  return (
    <div
      data-catalog-list-row
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      data-context-menu={contextMenu}
      aria-disabled={disabled || undefined}
      className={cn(
        "rounded-lg transition-colors hover:bg-[var(--sidebar-accent)]",
        selected && "bg-[var(--accent)] text-[var(--accent-foreground)]",
        dragging && "opacity-45",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
