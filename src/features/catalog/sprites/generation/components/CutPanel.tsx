import { Loader2 } from "lucide-react";

import type { SliceSettings } from "../lib/slice-geometry";
import { hintText, sectionLabel, smallButton } from "./dialog-styles";
import { PercentSlider } from "./PercentSlider";

type ScalarSetting = Exclude<keyof SliceSettings, "rowCuts" | "columnCuts">;

const SLIDERS: Array<{ key: ScalarSetting; label: string; min: number; max: number; step: number }> = [
  { key: "sideMargin", label: "Side margin", min: 0, max: 18, step: 0.1 },
  { key: "topBottomMargin", label: "Top/bottom margin", min: 0, max: 18, step: 0.1 },
  { key: "columnGap", label: "Column gap", min: 0, max: 24, step: 0.1 },
  { key: "rowGap", label: "Row gap", min: 0, max: 24, step: 0.1 },
  { key: "nudgeX", label: "Move sideways", min: -12, max: 12, step: 0.1 },
  { key: "nudgeY", label: "Move up or down", min: -12, max: 12, step: 0.1 },
  { key: "cropTop", label: "Crop top", min: 0, max: 40, step: 0.5 },
  { key: "cropBottom", label: "Crop bottom", min: 0, max: 40, step: 0.5 },
  { key: "cropLeft", label: "Crop left", min: 0, max: 40, step: 0.5 },
  { key: "cropRight", label: "Crop right", min: 0, max: 40, step: 0.5 },
];

/** "Adjust slices": re-cuts every sprite from its own sheet without a new request. */
export function CutPanel({
  settings,
  sheetCount,
  busy,
  onChange,
  onReset,
  onApply,
}: {
  settings: SliceSettings;
  sheetCount: number;
  busy: boolean;
  onChange: (settings: SliceSettings) => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const setCut = (axis: "rowCuts" | "columnCuts", index: number, value: number) =>
    onChange({ ...settings, [axis]: settings[axis].map((cut, position) => (position === index ? value : cut)) });

  return (
    <section className="space-y-3 rounded-md border border-[var(--border)] p-3">
      <h3 className={sectionLabel}>Adjust slices</h3>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {SLIDERS.map((slider) => (
          <PercentSlider
            key={slider.key}
            label={slider.label}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={settings[slider.key]}
            onChange={(value) => onChange({ ...settings, [slider.key]: value })}
          />
        ))}
        {settings.rowCuts.map((value, index) => (
          <PercentSlider
            key={`row-${index}`}
            label={`Row cut ${index + 1}`}
            min={-12}
            max={12}
            step={0.1}
            value={value}
            onChange={(next) => setCut("rowCuts", index, next)}
          />
        ))}
        {settings.columnCuts.map((value, index) => (
          <PercentSlider
            key={`column-${index}`}
            label={`Column cut ${index + 1}`}
            min={-12}
            max={12}
            step={0.1}
            value={value}
            onChange={(next) => setCut("columnCuts", index, next)}
          />
        ))}
      </div>
      <p className={hintText}>
        Use this when the generated {sheetCount === 1 ? "sheet has" : "sheets have"} borders, gutters, or uneven
        spacing. Applying re-slices the original source {sheetCount === 1 ? "sheet" : "sheets"} without regenerating.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onReset} disabled={busy} aria-label="Reset slices" className={smallButton}>
          Reset
        </button>
        <button type="button" onClick={onApply} disabled={busy} className={smallButton}>
          {busy && <Loader2 size="0.75rem" className="animate-spin" aria-hidden="true" />}
          {busy ? "Applying…" : "Apply slice"}
        </button>
      </div>
    </section>
  );
}
