import { cn } from "../../../lib/utils";
import { ColorPicker } from "../color-picker";
import { ChannelToggle, GroupHeading, Panel, RangeSlider } from "./control-parts";
import type { ChannelView } from "./controls-state";
import type { PaintChannel } from "./options";

interface PaintChannelsProps {
  channels: ChannelView[];
  strengthSummary: string;
  compact: boolean;
  disabled: boolean;
  onToggle: (channel: PaintChannel, enabled: boolean) => void;
  onStrength: (channel: PaintChannel, strength: number) => void;
}

function rowControls(view: ChannelView, { disabled, onToggle, onStrength }: PaintChannelsProps) {
  const sliderOn = view.enabled && view.hasPaint;
  const { channel } = view;
  return {
    toggle: (
      <ChannelToggle
        label={channel.label}
        checked={view.enabled}
        disabled={disabled || !view.hasPaint}
        onToggle={(enabled) => onToggle(channel, enabled)}
      />
    ),
    // A slider that can't be used shows 0; the stored strength stays as it is.
    slider: (
      <RangeSlider
        label={channel.label}
        title={channel.title}
        value={sliderOn ? view.strength : 0}
        disabled={disabled || !sliderOn}
        onValue={(strength) => onStrength(channel, strength)}
      />
    ),
    value: (
      <span className="shrink-0 text-right font-mono text-[0.5625rem] text-[var(--muted-foreground)] tabular-nums">
        {view.valueLabel}
      </span>
    ),
  };
}

/** Chat colors mode: how strongly each of the chat's colors shows on the card. */
export function SourceStrength(props: PaintChannelsProps) {
  const { channels, strengthSummary, compact } = props;
  return (
    <Panel className={cn("bg-[var(--secondary)]/55", compact ? "gap-1.5 p-2" : "gap-2 p-2.5")}>
      <GroupHeading aside={strengthSummary} compact={compact}>
        Source strength
      </GroupHeading>
      <div className={cn("grid min-w-0 grid-cols-1", compact ? "gap-1" : "gap-2 sm:grid-cols-3")}>
        {channels.map((view) => {
          const { toggle, slider, value } = rowControls(view, props);
          const name = (
            <span className="min-w-0 truncate text-[0.625rem] font-semibold text-[var(--foreground)]">
              {view.channel.label}
            </span>
          );
          return (
            <div
              key={view.channel.label}
              data-channel-row
              title={view.enabled ? view.channel.title : `${view.channel.label} channel is off.`}
              className={cn(
                "min-w-0 rounded-md bg-[var(--background)]/35 ring-1 ring-[var(--border)]/40",
                compact
                  ? "grid grid-cols-[4.75rem_minmax(0,1fr)_2rem] items-center gap-2 px-2 py-1.5"
                  : "grid grid-cols-1 gap-1.5 px-2.5 py-2",
              )}
            >
              {compact ? (
                <>
                  <div className="flex min-w-0 items-center justify-between gap-1.5">
                    {name}
                    {toggle}
                  </div>
                  {slider}
                  {value}
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    {name}
                    {toggle}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {slider}
                    {value}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

interface CustomPaintProps extends PaintChannelsProps {
  onColor: (channel: PaintChannel, color: string) => void;
}

/** Custom mode: each channel's own color, its switch and its strength. */
export function CustomPaint(props: CustomPaintProps) {
  const { channels, strengthSummary, compact, disabled, onColor } = props;
  return (
    <Panel className={cn("bg-[var(--secondary)]/55", compact ? "gap-1.5 p-2" : "gap-2 p-2.5")}>
      <GroupHeading aside={strengthSummary} compact={compact}>
        Custom paint
      </GroupHeading>
      <div className={cn("grid min-w-0 grid-cols-1", compact ? "gap-1.5" : "gap-2.5 lg:grid-cols-3")}>
        {channels.map((view) => {
          const { toggle, slider, value } = rowControls(view, props);
          return (
            <div
              key={view.channel.label}
              data-channel-row
              className={cn(
                "grid min-w-0 grid-cols-1 gap-2 rounded-md ring-1",
                compact ? "p-2" : "p-2.5",
                // A channel that's off only fades its own background and ring.
                view.enabled
                  ? "bg-[var(--background)]/35 ring-[var(--border)]/40"
                  : "bg-[var(--background)]/15 ring-[var(--border)]/20",
                disabled && "pointer-events-none",
              )}
            >
              <ColorPicker
                value={view.ownColor}
                onChange={(color) => onColor(view.channel, color)}
                gradient
                compact
                label={view.channel.label}
                helpText={view.channel.title}
                emptyText={view.channel.emptyText}
                disabled={disabled}
                headerAction={toggle}
              />
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[0.5625rem] font-medium text-[var(--muted-foreground)]">
                  {view.channel.label} strength
                </span>
                {value}
              </div>
              {slider}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
