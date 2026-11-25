import type { PointerEvent as ReactPointerEvent } from "react";
import type { Corner, SquarePart, Square } from "./crop-math";

interface SquareHandlers {
  onPress: (part: SquarePart, event: ReactPointerEvent<HTMLDivElement>) => void;
  onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onRelease: () => void;
}

// Cursors are inline: the app sets its own cursor on every element and forces `.cursor-*` classes to it.
const CORNERS: ReadonlyArray<{ corner: Corner; className: string; cursor: string }> = [
  { corner: "tl", className: "left-[-8px] top-[-8px]", cursor: "nwse-resize" },
  { corner: "tr", className: "right-[-8px] top-[-8px]", cursor: "nesw-resize" },
  { corner: "bl", className: "bottom-[-8px] left-[-8px]", cursor: "nesw-resize" },
  { corner: "br", className: "bottom-[-8px] right-[-8px]", cursor: "nwse-resize" },
];

/**
 * The crop square over the picture, with the outside dimmed by its shadow, and its four corner handles.
 * A move that reaches a corner also bubbles to the square, so it is handled twice (recorded behavior).
 */
export function CropSquare({ square, onPress, onMove, onRelease }: { square: Square } & SquareHandlers) {
  return (
    <div
      data-crop="box"
      className="absolute touch-none outline-2 outline-white [box-shadow:0_0_0_9999px_rgba(0,0,0,0.55)]"
      style={{ left: square.x, top: square.y, width: square.size, height: square.size, cursor: "move" }}
      onPointerDown={(event) => onPress("box", event)}
      onPointerMove={onMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
    >
      {CORNERS.map(({ corner, className, cursor }) => (
        <div
          key={corner}
          data-crop={corner}
          className={`absolute h-[14px] w-[14px] rounded-[2px] border border-black bg-white ${className}`}
          style={{ cursor }}
          onPointerDown={(event) => onPress(corner, event)}
          onPointerMove={onMove}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
        />
      ))}
    </div>
  );
}
