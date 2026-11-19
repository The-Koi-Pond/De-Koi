import { Loader2 } from "lucide-react";

import type { GenerationInfo } from "../hooks/use-sprite-generation";
import { hintText } from "./dialog-styles";

function heading(generation: GenerationInfo | null): string {
  if (generation?.matched) return "Generating matched full-body batches…";
  const single = generation ? generation.grid.cols * generation.grid.rows === 1 : false;
  if (generation?.type === "full-body")
    return single ? "Generating full-body pose…" : "Generating full-body pose sheet…";
  return single ? "Generating portrait sprite…" : "Generating expression sheet…";
}

function note(generation: GenerationInfo | null): string {
  if (generation?.matched) return "Each batch gets one automatic retry before pausing for your decision.";
  const single = generation ? generation.grid.cols * generation.grid.rows === 1 : false;
  if (generation?.type === "full-body" && !single) {
    return "This may take 30–60 seconds depending on the provider. The sheet will be sliced into poses after generation.";
  }
  return "This may take 30–60 seconds depending on the provider.";
}

/** The waiting step. Closing the dialog doesn't stop the request; its results land here. */
export function GeneratingStep({
  generation,
  progress,
}: {
  generation: GenerationInfo | null;
  progress: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-[var(--foreground)]">
      <Loader2 size="2rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
      <h3 className="font-semibold">{heading(generation)}</h3>
      <p role="status" aria-live="polite" className="min-h-4 text-xs">
        {generation?.matched ? (progress ?? "") : ""}
      </p>
      <p className={`${hintText} max-w-sm`}>{note(generation)}</p>
    </div>
  );
}
