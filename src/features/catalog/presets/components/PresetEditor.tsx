// ──────────────────────────────────────────────
// Full-Page Preset Editor
// The shell and the Overview tab live in ./preset-overview, the AI Review tab in ./preset-review.
// ──────────────────────────────────────────────
import { PresetEditorShell } from "./preset-overview";
import { PresetReviewTab } from "./preset-review";

export function PresetEditor() {
  return <PresetEditorShell renderReviewTab={(presetId) => <PresetReviewTab presetId={presetId} />} />;
}
