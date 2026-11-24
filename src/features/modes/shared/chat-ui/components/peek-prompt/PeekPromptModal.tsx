import { LoaderCircle, X } from "lucide-react";
import { useRef, type MouseEvent, type PointerEvent } from "react";

import { usePresetSummaries } from "../../../../../catalog/presets/index";
import { useEscapeOverlay } from "../../../../../../shared/hooks/use-escape-overlay";
import { cn } from "../../../../../../shared/lib/utils";
import { buildPromptAttributionViewModel } from "../../lib/prompt-attribution";
import type { PeekPromptData } from "../../types";
import { AttributionPanel } from "./AttributionPanel";
import { BlockList } from "./BlockList";
import { BudgetPanel } from "./BudgetPanel";
import { estimateTokens, formatCount, plural } from "./format";
import { buildPromptBlocks, shownMessages, type PromptBlock } from "./prompt-blocks";
import { SettingsPanel } from "./SettingsPanel";
import { presetLabel, settingPills } from "./settings";

const MUTED = "text-[var(--muted-foreground)]";

function sourceBadge(data: PeekPromptData) {
  if (data.exact) {
    return { label: "Exact Text Model Request", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
  }
  const label =
    data.source === "live_preview"
      ? "Live Preview"
      : data.source === "raw_messages"
        ? "Raw Messages"
        : "Prompt Preview";
  return { label, tone: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
}

/**
 * Closes only for a click whose press and release both landed on the backdrop itself, so selecting prompt text and
 * letting go outside the dialog (or the reverse) keeps it open.
 */
function useBackdropClose(onClose: () => void) {
  const pressed = useRef(false);
  const released = useRef(false);
  const onPress = (event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    pressed.current = event.target === event.currentTarget;
    released.current = false;
  };
  const onRelease = (event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    released.current = event.target === event.currentTarget;
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const close = event.target === event.currentTarget && pressed.current && released.current;
    pressed.current = false;
    released.current = false;
    if (close) onClose();
  };
  return { onPointerDown: onPress, onMouseDown: onPress, onPointerUp: onRelease, onMouseUp: onRelease, onClick };
}

function PromptContent({
  data,
  blocks,
  total,
  presets,
}: {
  data: PeekPromptData;
  blocks: PromptBlock[];
  total: number;
  presets: Array<{ id: string; name?: string | null }> | undefined;
}) {
  const pills = settingPills(data.generationInfo, data.parameters);
  const attribution = buildPromptAttributionViewModel(data.contextAttribution);
  return (
    <>
      {data.budget && <BudgetPanel budget={data.budget} />}
      {(data.generationInfo || pills.length > 0) && (
        <SettingsPanel
          info={data.generationInfo}
          pills={pills}
          preset={presetLabel(data.promptPresetId, presets)}
          presetId={data.promptPresetId}
          total={total}
        />
      )}
      {attribution && <AttributionPanel view={attribution} />}
      {data.agentNote && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[0.6875rem] text-amber-300/80">
          Note: {data.agentNote}
        </div>
      )}
      <BlockList blocks={blocks} />
    </>
  );
}

export function PeekPromptModal({ data, onClose }: { data: PeekPromptData; onClose: () => void }) {
  const { data: presets } = usePresetSummaries();
  useEscapeOverlay(() => {
    onClose();
  });
  const backdrop = useBackdropClose(onClose);

  const loading = data.loading === true;
  // Computed even while loading, so malformed data throws in every state.
  const blocks = buildPromptBlocks(shownMessages(data));
  const total =
    data.budget?.estimatedPromptTokens ?? estimateTokens(data.messages.map((message) => message.content).join(""));
  const badge = loading || data.error ? null : sourceBadge(data);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      {...backdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assembled prompt"
        onClick={(event) => event.stopPropagation()}
        className="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="shrink-0 text-sm font-bold">Assembled Prompt</h3>
            {badge && (
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-[0.5625rem] font-bold uppercase",
                  badge.tone,
                )}
              >
                {badge.label}
              </span>
            )}
            <span className={cn("text-[0.625rem]", MUTED)}>
              {loading
                ? "assembling"
                : `${blocks.length} ${plural(blocks.length, "section")} · ~${formatCount(total)} tokens`}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cn("rounded-lg p-1.5 transition-all hover:bg-[var(--accent)]", MUTED)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {loading && (
            <div
              role="status"
              aria-label="Assembling prompt"
              className={cn("flex min-h-48 items-center justify-center", MUTED)}
            >
              <LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin" />
            </div>
          )}
          {/* `data.error` is the JSX condition itself, as before: a falsy non-string such as 0 renders as text. */}
          {!loading && data.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs leading-normal text-red-300/90"
            >
              {data.error}
            </div>
          )}
          {!loading && !data.error && <PromptContent data={data} blocks={blocks} total={total} presets={presets} />}
        </div>
      </div>
    </div>
  );
}
