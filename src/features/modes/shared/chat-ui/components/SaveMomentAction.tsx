import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Bookmark, Brain, GitBranch, Loader2, Paintbrush, ScrollText } from "lucide-react";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useGalleryStore } from "../../../../../shared/stores/gallery.store";
import { cn } from "../../../../../shared/lib/utils";
import {
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
  onCloneSceneFromHere?: (messageId: string) => void;
  destinations?: readonly SaveMomentDestination[];
  onDestinationSelect?: (destinationId: string, source: SaveMomentSource) => void | Promise<void>;
  buttonClassName?: string;
  iconSize?: string | number;
  tabIndex?: number;
  align?: "start" | "end";
}

interface IllustrateMomentActionProps {
  source: SaveMomentSource;
  onIllustrateMoment: (source: SaveMomentSource) => void | Promise<void>;
  buttonClassName?: string;
  iconSize?: string | number;
  tabIndex?: number;
}

function iconForItem(item: SaveMomentMenuItem): ReactNode {
  if (item.id === "chat-summary") return <ScrollText size="0.75rem" />;
  if (item.id === "lore-draft") return <BookOpen size="0.75rem" />;
  if (item.destinationId) return <Bookmark size="0.75rem" />;
  return <GitBranch size="0.75rem" />;
}

export function IllustrateMomentAction({
  source,
  onIllustrateMoment,
  buttonClassName,
  iconSize = DEFAULT_ICON_SIZE,
  tabIndex,
}: IllustrateMomentActionProps) {
  const illustratePending = useGalleryStore((s) => s.illustratingChatIds.includes(source.chatId));
  const runIllustration = useGalleryStore((s) => s.runIllustration);
  const label = illustratePending ? "Illustrating this message" : "Illustrate this message";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (illustratePending) return;
        void runIllustration(source.chatId, () => onIllustrateMoment(source)).catch(() => undefined);
      }}
      title={label}
      aria-label={label}
      aria-busy={illustratePending}
      disabled={illustratePending}
      tabIndex={tabIndex}
      className={cn(buttonClassName, illustratePending && "cursor-wait text-[var(--primary)]")}
    >
      {illustratePending ? <Loader2 size={iconSize} className="animate-spin" /> : <Paintbrush size={iconSize} />}
    </button>
  );
}

export function SaveMomentAction({
  source,
  onCreateSummaryDraft,
  onCloneSceneFromHere,
  destinations,
  onDestinationSelect,
  buttonClassName,
  iconSize = DEFAULT_ICON_SIZE,
  tabIndex,
  align = "end",
}: SaveMomentActionProps) {
  const [open, setOpen] = useState(false);
  const openModal = useUIStore((state) => state.openModal);
  const rootRef = useRef<HTMLSpanElement>(null);

  const items = useMemo(
    () =>
      buildSaveMomentMenuItems({
        canCreateSummaryDraft: !!onCreateSummaryDraft,
        canBranch: false,
        canCloneScene: !!onCloneSceneFromHere,
        canDraftLore: true,
        destinations,
      }),
    [destinations, onCloneSceneFromHere, onCreateSummaryDraft],
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

  const handleSelect = async (id: SaveMomentMenuItemId) => {
    if (id === "chat-summary") {
      onCreateSummaryDraft?.(source);
      setOpen(false);
      return;
    }
    if (id === "lore-draft") {
      openModal("save-moment-lore-draft", { source: { ...source } });
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
        title="Remember this..."
        aria-label="Remember this..."
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={tabIndex}
        className={buttonClassName}
      >
        <Brain size={iconSize} />
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
