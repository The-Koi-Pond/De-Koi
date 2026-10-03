import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Folder rows carry this attribute so a drag can find the folder under the pointer. */
const CONNECTION_FOLDER_ID_ATTRIBUTE = "data-connection-folder-id";

export interface ConnectionFolderDrag {
  folderId: string;
  /** The folder the dragged one would take the place of on release. */
  overId: string | null;
}

/** Moves `folderId` into `targetId`'s position; the folders in between shift by one. */
export function moveFolder(order: readonly string[], folderId: string, targetId: string): string[] {
  const from = order.indexOf(folderId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, folderId);
  return next;
}

function folderIdAt(x: number, y: number): string | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${CONNECTION_FOLDER_ID_ATTRIBUTE}]`);
  return row?.getAttribute(CONNECTION_FOLDER_ID_ATTRIBUTE) ?? null;
}

/**
 * Reorders folders by dragging their grip with a mouse, pen or finger. The
 * folder under the pointer is reported as the drop target while dragging, and
 * the new order is committed once, on release over another folder.
 */
export function useConnectionFolderReorder(order: readonly string[], onReorder: (nextOrder: string[]) => void) {
  const [drag, setDrag] = useState<ConnectionFolderDrag | null>(null);
  const latest = useRef({ order, onReorder });
  const stopRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    latest.current = { order, onReorder };
  });

  useEffect(() => () => stopRef.current?.(), []);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>, folderId: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (latest.current.order.length < 2) return;
    // Keeps a mouse press from selecting text or starting a native drag.
    event.preventDefault();
    stopRef.current?.();

    const pointerId = event.pointerId;
    let overId: string | null = null;
    setDrag({ folderId, overId });

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const hovered = folderIdAt(moveEvent.clientX, moveEvent.clientY);
      const next = hovered === folderId ? null : hovered;
      if (next === overId) return;
      overId = next;
      setDrag({ folderId, overId });
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      stopRef.current = null;
      setDrag(null);
    };
    const onEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      stop();
      if (endEvent.type !== "pointerup" || !overId) return;
      const nextOrder = moveFolder(latest.current.order, folderId, overId);
      if (nextOrder.some((id, index) => id !== latest.current.order[index])) latest.current.onReorder(nextOrder);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    stopRef.current = stop;
  }, []);

  return { drag, startDrag };
}
