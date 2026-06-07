// ──────────────────────────────────────────────
// Custom Emoji / Sticker tag control
// A per-card overlay control shared by the character, persona, and global
// galleries. Lets a user tag one gallery image as a custom emoji or sticker,
// name it, rename it, or clear it. Eligibility is gated by pixel dimensions
// (read client-side); an oversized choice flashes the card red with a warning.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import { Pencil, Smile, Sticker, Tag, X } from "lucide-react";

import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { showPromptDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import {
  type CustomKind,
  type CustomTagPatch,
  readImageDimensions,
  slugifyCustomName,
  validateDimensionsForKind,
} from "../../lib/custom-emoji";

interface TaggableImage {
  id: string;
  url: string;
  filename?: string | null;
  customKind?: CustomKind | null;
  customName?: string | null;
}

function defaultNameFor(image: TaggableImage): string {
  if (image.customName) return image.customName;
  const base = (image.filename ?? "").replace(/\.[^.]+$/, "");
  return slugifyCustomName(base);
}

export function CustomEmojiTagButton({
  image,
  onApply,
}: {
  image: TaggableImage;
  onApply: (patch: CustomTagPatch) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [busy, setBusy] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const triggerFlash = useCallback((message: string) => {
    toast.error(message);
    setFlashing(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), 1300);
  }, []);

  const promptName = useCallback(
    async (title: string) => {
      const raw = await showPromptDialog({
        title,
        message: "Name it. In prompts it appears as :name: (emoji) or sticker:name: (sticker).",
        defaultValue: defaultNameFor(image),
        placeholder: "e.g. kekw",
        confirmLabel: "Save",
      });
      if (raw == null) return null;
      const slug = slugifyCustomName(raw);
      if (!slug) {
        toast.error("Enter a name using letters or numbers.");
        return null;
      }
      return slug;
    },
    [image],
  );

  const applyKind = useCallback(
    async (kind: CustomKind) => {
      setBusy(true);
      try {
        const { width, height } = await readImageDimensions(image.url);
        const verdict = validateDimensionsForKind(width, height, kind);
        if (!verdict.ok) {
          triggerFlash(verdict.reason);
          return;
        }
        const name = await promptName(kind === "emoji" ? "Custom Emoji" : "Custom Sticker");
        if (!name) return;
        onApply({ customKind: kind, customName: name, width, height });
      } catch {
        triggerFlash("Could not read this image to measure it.");
      } finally {
        setBusy(false);
      }
    },
    [image.url, onApply, promptName, triggerFlash],
  );

  const rename = useCallback(async () => {
    if (!image.customKind) return;
    const name = await promptName("Rename");
    if (!name) return;
    onApply({ customKind: image.customKind, customName: name });
  }, [image.customKind, onApply, promptName]);

  const menuItems = useCallback((): ContextMenuItem[] => {
    if (!image.customKind) {
      return [
        { label: "Make emoji", icon: <Smile size="0.8125rem" />, onSelect: () => void applyKind("emoji") },
        { label: "Make sticker", icon: <Sticker size="0.8125rem" />, onSelect: () => void applyKind("sticker") },
      ];
    }
    const other: CustomKind = image.customKind === "emoji" ? "sticker" : "emoji";
    return [
      { label: "Rename", icon: <Pencil size="0.8125rem" />, onSelect: () => void rename() },
      {
        label: image.customKind === "emoji" ? "Switch to sticker" : "Switch to emoji",
        icon: other === "emoji" ? <Smile size="0.8125rem" /> : <Sticker size="0.8125rem" />,
        onSelect: () => void applyKind(other),
      },
      {
        label: image.customKind === "emoji" ? "Remove emoji" : "Remove sticker",
        icon: <X size="0.8125rem" />,
        destructive: true,
        onSelect: () => onApply({ customKind: null, customName: null }),
      },
    ];
  }, [applyKind, image.customKind, onApply, rename]);

  const openMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const tagged = !!image.customKind;
  const KindIcon = image.customKind === "sticker" ? Sticker : Smile;

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={openMenu}
        onMouseDown={(e) => e.stopPropagation()}
        title={
          tagged
            ? `${image.customKind === "emoji" ? "Emoji" : "Sticker"}: ${image.customName} — click to edit`
            : "Tag as custom emoji or sticker"
        }
        aria-label={tagged ? `Edit custom ${image.customKind}` : "Tag as custom emoji or sticker"}
        className={cn(
          "absolute left-1 top-1 z-10 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-lg px-1.5 py-1 text-[0.625rem] font-medium shadow-sm backdrop-blur transition-all",
          tagged
            ? "bg-[var(--primary)]/85 text-[var(--primary-foreground)]"
            : "bg-black/55 text-white opacity-0 group-hover:opacity-100 max-md:opacity-100",
        )}
      >
        {tagged ? <KindIcon size="0.75rem" className="shrink-0" /> : <Tag size="0.75rem" className="shrink-0" />}
        {tagged && <span className="truncate">{image.customName}</span>}
      </button>

      {flashing && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-xl bg-red-500/20 ring-2 ring-red-500 animate-pulse"
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
    </>
  );
}
