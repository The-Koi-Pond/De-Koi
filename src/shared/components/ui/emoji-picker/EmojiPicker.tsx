import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../../lib/utils";
import { EMOJI_CATEGORIES } from "./emoji-categories";
import { emojiName, normalizeQuery, searchEmojis, type EmojiSection } from "./emoji-search";

interface EmojiPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  /** The button that opened it: horizontal alignment, and clicks on it don't count as "outside". */
  anchorRef?: RefObject<HTMLElement | null>;
  /** The bar whose top edge the picker sits above. Falls back to the anchor. */
  containerRef?: RefObject<HTMLElement | null>;
}

const GAP_PX = 8;
const PANEL_WIDTH_PX = 336; // 21rem
const NARROW_WINDOW_PX = 480;

/** Fixed-position offsets, measured once when the picker opens. Without an anchor it stays bottom-left. */
function measurePosition(anchor: HTMLElement | null, container: HTMLElement | null): CSSProperties {
  if (!anchor) return { bottom: 0, left: 0 };
  const anchorRect = anchor.getBoundingClientRect();
  const referenceTop = (container ?? anchor).getBoundingClientRect().top;
  const bottom = window.innerHeight - referenceTop + GAP_PX;
  const width = window.innerWidth;
  if (width < NARROW_WINDOW_PX) {
    return { bottom, left: Math.max(GAP_PX, (width - Math.min(PANEL_WIDTH_PX, width - 2 * GAP_PX)) / 2) };
  }
  return { bottom, right: Math.max(GAP_PX, width - anchorRect.right) };
}

export function EmojiPicker({ open, ...panelProps }: EmojiPickerProps) {
  // The active tab outlives the panel, so reopening keeps the last category (decision 5).
  const [activeIndex, setActiveIndex] = useState(0);
  if (!open) return null;
  return createPortal(
    <EmojiPanel {...panelProps} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} />,
    document.body,
  );
}

interface EmojiPanelProps extends Omit<EmojiPickerProps, "open"> {
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

/** Mounted only while open, so every opening starts with an empty search (decision 5). */
function EmojiPanel({ onClose, onSelect, anchorRef, containerRef, activeIndex, onActiveIndexChange }: EmojiPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<CSSProperties>({ bottom: 0, left: 0 });

  useLayoutEffect(() => {
    setPosition(measurePosition(anchorRef?.current ?? null, containerRef?.current ?? null));
  }, [anchorRef, containerRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Any press outside the panel and the anchor closes it, with or without an anchor (decision 7).
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose, anchorRef]);

  const searching = normalizeQuery(query) !== "";
  const active = EMOJI_CATEGORIES[activeIndex];
  const sections: EmojiSection[] = searching ? searchEmojis(query) : [active];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Emoji picker"
      style={position}
      className="fixed z-[9999] flex h-[22rem] w-[21rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
    >
      <div className="border-b border-[var(--border)] px-3 py-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emojis..."
          aria-label="Search emojis"
          autoFocus
          className="w-full rounded-md bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/50"
        />
      </div>

      <div className="flex gap-0.5 border-b border-[var(--border)] px-2 py-1">
        {EMOJI_CATEGORIES.map((category, index) => (
          <button
            key={category.label}
            type="button"
            title={category.label}
            aria-label={category.label}
            aria-pressed={index === activeIndex}
            // A tab click always shows that category, clearing any search (decision 6).
            onClick={() => {
              onActiveIndexChange(index);
              setQuery("");
            }}
            className={cn(
              "flex-1 rounded-md py-1 text-base transition-colors",
              index === activeIndex ? "bg-[var(--accent)]" : "hover:bg-[var(--secondary)]",
            )}
          >
            {category.icon}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sections.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">No emojis found</p>
        ) : (
          sections.map((section) => (
            <section key={section.label} className="mb-2">
              <h3 className="mb-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {section.label}
              </h3>
              <div className="grid grid-cols-8 gap-0.5">
                {section.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emojiName(emoji)}
                    onClick={() => onSelect(emoji)}
                    className="flex aspect-square items-center justify-center rounded-md text-xl transition-transform hover:scale-125 hover:bg-[var(--secondary)]"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
