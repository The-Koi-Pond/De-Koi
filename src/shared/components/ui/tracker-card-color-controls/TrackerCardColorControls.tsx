import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { TrackerCardColorConfig, TrackerCardColorMode } from "../../../../engine/contracts/types/persona";
import { cleanTrackerCardColorConfig, type TrackerCardPaintColors } from "../../../lib/tracker-card-colors";
import { cn } from "../../../lib/utils";
import { GroupHeading, OptionButton, OptionTrack, Panel, RangeSlider } from "./control-parts";
import { describeControls, readCurrentConfig, swatchStyle } from "./controls-state";
import { FINISH_PRESETS, FINISH_SLIDERS, MODE_OPTIONS, STAGE_OPTIONS, type PaintChannel } from "./options";
import { CustomPaint, SourceStrength } from "./PaintChannels";

export type TrackerCardColorEntityLabel = "Character" | "Persona";

interface TrackerCardColorControlsProps {
  value: TrackerCardColorConfig | string | null | undefined;
  onChange: (value: TrackerCardColorConfig) => void;
  chatColors: TrackerCardPaintColors;
  entityLabel: TrackerCardColorEntityLabel;
  variant?: "full" | "compact";
  disabled?: boolean;
}

/**
 * Where a character's or persona's tracker card gets its colors, its portrait stage, its finish and
 * how strongly each paint channel shows. Keeps no copy of the config: every change hands one cleaned
 * config to `onChange`, and the next render shows whatever `value` says.
 */
export function TrackerCardColorControls({
  value,
  onChange,
  chatColors,
  entityLabel,
  variant = "full",
  disabled = false,
}: TrackerCardColorControlsProps) {
  const [expanded, setExpanded] = useState(true);
  const compact = variant === "compact";
  const config = readCurrentConfig(value);
  const view = describeControls(config, chatColors);

  const commit = (change: TrackerCardColorConfig) => {
    if (disabled) return;
    onChange(cleanTrackerCardColorConfig({ ...config, ...change }));
  };

  const selectMode = (mode: TrackerCardColorMode) => {
    if (mode !== "custom") return commit({ mode });
    // Custom starts from the config's own colors, falling back to the chat colors.
    commit({
      mode,
      nameColor: config.nameColor || chatColors.nameColor || "",
      dialogueColor: config.dialogueColor || chatColors.dialogueColor || "",
      boxColor: config.boxColor || chatColors.boxColor || "",
    });
  };

  const paintProps = {
    channels: view.channels,
    strengthSummary: view.strengthSummary,
    compact,
    disabled,
    onToggle: (channel: PaintChannel, enabled: boolean) => commit({ [channel.enabledField]: enabled }),
    onStrength: (channel: PaintChannel, strength: number) => commit({ [channel.opacityField]: strength }),
  };

  const selectedPreset = (finish: (typeof FINISH_PRESETS)[number]["finish"]) =>
    view.finish.materialBrightness === finish.materialBrightness &&
    view.finish.glowIntensity === finish.glowIntensity &&
    view.finish.contrastIntensity === finish.contrastIntensity;

  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]",
        disabled && "opacity-75",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        title={expanded ? "Collapse tracker card colors" : "Expand tracker card colors"}
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          "flex w-full min-w-0 items-center text-left transition-colors outline-none hover:bg-[var(--accent)]/40 focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-inset",
          expanded ? "rounded-t-xl" : "rounded-xl",
          compact ? "gap-2 px-3 py-2.5" : "gap-3 px-4 py-3",
        )}
      >
        <span className="min-w-0 flex-1">
          <span data-heading className="block truncate text-xs font-semibold text-[var(--foreground)]">
            {compact ? `${entityLabel} card` : `${entityLabel} Tracker Card`}
          </span>
          {/* Wraps instead of truncating, so the finish numbers stay readable in a narrow drawer. */}
          <span data-summary className="mt-0.5 block text-[0.625rem] break-words text-[var(--muted-foreground)]">
            {view.summary}
          </span>
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          {view.channels.map((channelView) => (
            <span
              key={channelView.channel.label}
              data-swatch
              className={cn(
                "ring-1 ring-[var(--border)]",
                compact ? "size-4 rounded" : "size-5 rounded-md",
                !channelView.enabled && "opacity-35",
              )}
              style={swatchStyle(channelView.effectiveColor)}
            />
          ))}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-[var(--muted-foreground)]" />
        )}
      </button>

      {expanded && (
        <div className={cn("grid min-w-0 grid-cols-1", compact ? "gap-2 px-2.5 pb-2.5" : "gap-2.5 px-4 pb-4")}>
          <Panel className={cn("bg-[var(--secondary)]/65", compact ? "gap-2 p-2" : "gap-3 p-2.5 md:grid-cols-2")}>
            <div className="grid min-w-0 grid-cols-1 gap-1.5">
              <GroupHeading compact={compact}>Source</GroupHeading>
              <OptionTrack className="grid-cols-3">
                {MODE_OPTIONS.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    icon={option.icon}
                    selected={view.mode === option.value}
                    disabled={disabled}
                    compact={compact}
                    onSelect={() => selectMode(option.value)}
                  />
                ))}
              </OptionTrack>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-1.5">
              <GroupHeading compact={compact}>Stage</GroupHeading>
              <OptionTrack className={compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}>
                {STAGE_OPTIONS.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    title={option.title}
                    icon={option.icon}
                    selected={view.stage === option.value}
                    disabled={disabled}
                    compact={compact}
                    onSelect={() => commit({ portraitStageBackground: option.value })}
                  />
                ))}
              </OptionTrack>
            </div>
          </Panel>

          <Panel className={cn("bg-[var(--secondary)]/65", compact ? "gap-1.5 p-2" : "gap-2 p-2.5")}>
            <GroupHeading compact={compact}>Finish</GroupHeading>
            <div
              className={cn(
                "grid min-w-0 grid-cols-1",
                compact ? "gap-1.5" : "gap-2 md:grid-cols-[minmax(10rem,1fr)_minmax(0,3fr)] md:items-center",
              )}
            >
              {/* The three presets always sit in one row. */}
              <OptionTrack className="grid-cols-3">
                {FINISH_PRESETS.map((preset) => (
                  <OptionButton
                    key={preset.label}
                    label={preset.label}
                    title={preset.title}
                    selected={selectedPreset(preset.finish)}
                    disabled={disabled}
                    compact={compact}
                    onSelect={() => commit(preset.finish)}
                  />
                ))}
              </OptionTrack>
              <div className={cn("grid min-w-0 grid-cols-1", compact ? "gap-1" : "gap-2 sm:grid-cols-3")}>
                {FINISH_SLIDERS.map((slider) => {
                  const shown = view.finish[slider.field];
                  const input = (
                    <RangeSlider
                      label={slider.label}
                      title={slider.title}
                      value={shown}
                      disabled={disabled}
                      onValue={(next) => commit({ [slider.field]: next })}
                    />
                  );
                  // The whole row is the label, so hovering the name shows the tooltip too.
                  return compact ? (
                    <label
                      key={slider.field}
                      title={slider.title}
                      className="grid min-w-0 grid-cols-[3.75rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-md bg-[var(--background)]/35 px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-[0.5625rem] font-medium text-[var(--foreground)]">
                        {slider.label}
                      </span>
                      {input}
                      <span className="text-right font-mono text-[0.5625rem] text-[var(--muted-foreground)] tabular-nums">
                        {shown}%
                      </span>
                    </label>
                  ) : (
                    <label
                      key={slider.field}
                      title={slider.title}
                      className="grid min-w-0 grid-cols-1 gap-2 rounded-md bg-[var(--background)]/35 px-2.5 py-2 ring-1 ring-[var(--border)]/40"
                    >
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[0.625rem] font-semibold text-[var(--foreground)]">
                          {slider.label}
                        </span>
                        <span className="shrink-0 rounded-full bg-[var(--secondary)] px-1.5 py-px font-mono text-[0.5625rem] text-[var(--muted-foreground)] tabular-nums">
                          {shown}%
                        </span>
                      </span>
                      {input}
                    </label>
                  );
                })}
              </div>
            </div>
          </Panel>

          {view.mode === "chat" && <SourceStrength {...paintProps} />}
          {view.mode === "custom" && (
            <CustomPaint
              {...paintProps}
              onColor={(channel, color) => commit({ mode: "custom", [channel.colorField]: color })}
            />
          )}
        </div>
      )}
    </div>
  );
}
