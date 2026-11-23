import { useRef, useState, type DragEvent } from "react";

// Drag to reorder (docs/provenance/preset-sections.md, "Drag to reorder"). A card drags only after a mouse-down on
// its grip; that grip press is remembered until a drag ends. The drop place is an insert index: before card `i`, or
// `count` for after the last card. Its own place (before or after the dragged card) shows no line and drops nothing.
// Over the list's empty space the line goes after the last card below it, before the first card above it, and stays
// where it was in the gaps between cards.

const SECTION_CARD_ATTRIBUTE = "data-section-index";

export interface SectionDrag {
  /** The card being dragged (shown faded). */
  draggedIndex: number | null;
  /** Where the drop line shows: before this card, or after the last one when it equals the card count. */
  dropIndex: number | null;
  gripDown: (index: number) => void;
  dragStart: (event: DragEvent<HTMLElement>, index: number) => void;
  dragEnd: () => void;
  /** For the element holding the cards: dragging over a card or over the empty part of the list. */
  dragOver: (event: DragEvent<HTMLElement>) => void;
  drop: (event: DragEvent<HTMLElement>) => void;
}

function cardAt(target: EventTarget | null): { index: number; element: Element } | null {
  const element = target instanceof Element ? target.closest(`[${SECTION_CARD_ATTRIBUTE}]`) : null;
  if (!element) return null;
  return { index: Number(element.getAttribute(SECTION_CARD_ATTRIBUTE)), element };
}

export function useSectionDrag(count: number, onMove: (from: number, insertAt: number) => void): SectionDrag {
  const grip = useRef<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const reset = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

  /** The insert index for the pointer over the list's empty space, or `undefined` in a gap between cards. */
  const listPlace = (list: HTMLElement, clientY: number): number | undefined => {
    const cards = list.querySelectorAll(`[${SECTION_CARD_ATTRIBUTE}]`);
    const first = cards[0];
    const last = cards[cards.length - 1];
    if (!first || !last) return undefined;
    if (clientY < first.getBoundingClientRect().top) return 0;
    if (clientY > last.getBoundingClientRect().bottom) return count;
    return undefined;
  };

  return {
    draggedIndex,
    dropIndex,
    gripDown: (index) => {
      grip.current = index;
    },
    dragStart: (event, index) => {
      if (grip.current !== index) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      setDraggedIndex(index);
    },
    dragEnd: () => {
      grip.current = null;
      reset();
    },
    dragOver: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (draggedIndex === null) return;
      const card = cardAt(event.target);
      let insertAt: number | undefined;
      if (card) {
        const rect = card.element.getBoundingClientRect();
        insertAt = event.clientY < rect.top + rect.height / 2 ? card.index : card.index + 1;
      } else {
        insertAt = listPlace(event.currentTarget, event.clientY);
        if (insertAt === undefined) return;
      }
      const ownPlace = insertAt === draggedIndex || insertAt === draggedIndex + 1;
      setDropIndex(ownPlace ? null : insertAt);
    },
    drop: (event) => {
      event.preventDefault();
      const from = draggedIndex;
      const insertAt = dropIndex;
      reset();
      if (from !== null && insertAt !== null) onMove(from, insertAt);
    },
  };
}
