import type { PeekPromptData } from "../../types";
import { formatCount } from "./format";
import type { SettingPill } from "./settings";

const MUTED = "text-[var(--muted-foreground)]";

function tokenSummary(total: number, info: PeekPromptData["generationInfo"]) {
  let text = `~${formatCount(total)} est. tokens`;
  if (!info) return text;
  if (info.tokensPrompt != null) text += ` | ${formatCount(info.tokensPrompt)} actual prompt tokens`;
  if ((info.tokensCachedPrompt ?? 0) > 0) text += ` | ${formatCount(info.tokensCachedPrompt!)} cached`;
  if ((info.tokensCacheWritePrompt ?? 0) > 0) text += ` | ${formatCount(info.tokensCacheWritePrompt!)} cache write`;
  return text;
}

export function SettingsPanel({
  info,
  pills,
  preset,
  presetId,
  total,
}: {
  info: PeekPromptData["generationInfo"];
  pills: SettingPill[];
  preset: string | null;
  presetId: string | null | undefined;
  total: number;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem]">
        {info?.model && (
          <span className="font-medium text-[var(--foreground)]">
            {info.provider ? <span className={`font-normal ${MUTED}`}>{info.provider} / </span> : null}
            {info.model}
          </span>
        )}
        {preset && (
          <span className="font-medium text-[var(--foreground)]" title={presetId ?? undefined}>
            <span className={`font-normal ${MUTED}`}>Preset / </span>
            {preset}
          </span>
        )}
        <span className={MUTED}>{tokenSummary(total, info)}</span>
      </div>
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pills.map((pill) => (
            <span
              key={pill.label}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/50 px-2 py-0.5 text-[0.625rem]"
            >
              <span className={MUTED}>{pill.label}</span>
              <span className="font-medium text-[var(--foreground)]">{pill.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
