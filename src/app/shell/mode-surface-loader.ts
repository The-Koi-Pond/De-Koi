export function loadModeSurface() {
  return import("../../features/modes/router/shell").then((module) => ({ default: module.ModeSurface }));
}
