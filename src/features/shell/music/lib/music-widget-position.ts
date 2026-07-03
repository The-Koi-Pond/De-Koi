export interface MusicWidgetPosition {
  x: number;
  y: number;
}

export interface MusicWidgetSize {
  width: number;
  height: number;
}

const EDGE_MARGIN = 8;
const LEFT_OFFSET = 16;
const COMPOSER_CLEARANCE = 128;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function clampMusicWidgetPosition(
  position: MusicWidgetPosition,
  viewport: MusicWidgetSize,
  widget: MusicWidgetSize,
  margin = EDGE_MARGIN,
): MusicWidgetPosition {
  return {
    x: Math.round(clampNumber(position.x, margin, viewport.width - widget.width - margin)),
    y: Math.round(clampNumber(position.y, margin, viewport.height - widget.height - margin)),
  };
}

export function defaultMusicWidgetPosition(viewport: MusicWidgetSize, widget: MusicWidgetSize): MusicWidgetPosition {
  return clampMusicWidgetPosition(
    {
      x: LEFT_OFFSET,
      y: COMPOSER_CLEARANCE,
    },
    viewport,
    widget,
  );
}
