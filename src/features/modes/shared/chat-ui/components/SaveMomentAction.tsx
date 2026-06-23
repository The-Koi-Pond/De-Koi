import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bookmark, Check, Copy, GitBranch, ScrollText } from "lucide-react";
import { cn, copyToClipboard } from "../../../../../shared/lib/utils";
import {
  buildSaveMomentExportText,
  buildSaveMomentMenuItems,
  type SaveMomentDestination,
  type SaveMomentMenuItem,
  type SaveMomentMenuItemId,
  type SaveMomentSource,
} from "../lib/save-moment";

const DEFAULT_ICON_SIZE = "0.8125rem";

interface SaveMomentActionProps {
  source: SaveMomentSource;
  onCreateSummaryDraft?: (source: SaveMomentSource) => void;
  onBranch?: (messageId: string) => void;
  onCloneSceneFromHere?: (messageId: string) => void;
  destinations?: readonly SaveMomentDestination[];
  onDestinationSelect?: (destinationId: string, source: SaveMomentSource) => void | Promise<void>;
  buttonClassName?: string;
  iconSize?: string | number;
  tabIndex?: number;
  align?: "start" | "end";
}

function iconForItem(item: SaveMomentMenuItem): ReactNode {
  if (item.id === "copy-snippet") return <Copy size="0.75rem" />;
  if (item.id === "chat-summary") return <ScrollText size="0.75rem" />;
  if (item.destinationId) return <Bookmark size="0.75rem" />;
  return <GitBranch size="0.75rem" />;
}

export function SaveMomentAction({
  source,
  onCreateSummaryDraft,
  onBranch,
  onCloneSceneFromHere,
  destinations,
  onDestinationSelect,
  buttonClassName,
  iconSize = DEFAULT_ICON_SIZE,
  tabIndex,
  align = "end",
}: SaveMomentActionProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const resetCopiedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const items = useMemo(
    () =>
      buildSaveMomentMenuItems({
        canCreateSummaryDraft: !!onCreateSummaryDraft,
        canBranch: !!onBranch,
        canCloneScene: !!onCloneSceneFromHere,
        destinations,
      }),
    [destinations, onBranch, onCloneSceneFromHere, onCreateSummaryDraft],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (resetCopiedRef.current) clearTimeout(resetCopiedRef.current);
    };
  }, []);

  const markCopied = () => {
    setCopied(true);
    if (resetCopiedRef.current) clearTimeout(resetCopiedRef.current);
    resetCopiedRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const handleSelect = async (id: SaveMomentMenuItemId) => {
    if (id === "copy-snippet") {
      const didCopy = await copyToClipboard(buildSaveMomentExportText(source));
      if (didCopy) markCopied();
      setOpen(false);
      return;
    }
    if (id === "chat-summary") {
      onCreateSummaryDraft?.(source);
      setOpen(false);
      return;
    }
    if (id === "branch") {
      onBranch?.(source.messageId);
      setOpen(false);
      return;
    }
    if (id === "clone-scene") {
      onCloneSceneFromHere?.(source.messageId);
      setOpen(false);
      return;
    }
    const destinationId = items.find((item) => item.id === id)?.destinationId;
    if (destinationId) await onDestinationSelect?.(destinationId, source);
    setOpen(false);
  };

  return (
    <span ref={rootRef} className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Save Moment..."
        aria-label="Save Moment..."
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={tabIndex}
        className={buttonClassName}
      >
        {copied ? <Check size={iconSize} /> : <Bookmark size={iconSize} />}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-1 min-w-44 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] py-1 text-[0.75rem] shadow-xl ring-1 ring-black/5",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => void handleSelect(item.id)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <span className="text-[var(--muted-foreground)]">{iconForItem(item)}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}