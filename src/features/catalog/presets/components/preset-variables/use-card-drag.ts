import { useRef, useState, type DragEvent } from "react";

// Drag to reorder (docs/provenance/preset-variables.md, "Drag to reorder"). A card drags only after a mouse-down on
// its grip; that grip press is remembered until a drag ends. The drop place is an insert index: before card `i`, or
// `count` for after the last card. Its own place (before or after the dragged card) shows no line and drops nothing.

export interface CardDrag {
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

/** The card index an event happened on, from the card's `data-card-index`, or `null` for the list itself. */
function cardIndexOf(target: EventTarget | null): { index: number; element: HTMLElement } | null {
  const element = target instanceof Element ? target.closest<HTMLElement>("[data-card-index]") : null;
  if (!element) return null;
  return { index: Number(element.dataset.cardIndex), element };
}

export function useCardDrag(count: number, onMove: (from: number, insertAt: number) => void): CardDrag {
  const grip = useRef<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const reset = () => {
    setDraggedIndex(null);
    setDropIndex(null);
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
      const card = cardIndexOf(event.target);
      let insertAt = count;
      if (card) {
        const rect = card.element.getBoundingClientRect();
        insertAt = event.clientY < rect.top + rect.height / 2 ? card.index : card.index + 1;
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
