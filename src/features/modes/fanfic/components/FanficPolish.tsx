import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { FanficPolishReport, FanficPolishStep, FanficState } from "../../../../engine/contracts/types/fanfic";
import { fanficAutoPolishOn } from "../../../../engine/modes/fanfic/polish";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useUpdateChatMetadata } from "../../../catalog/chats/index";
import { FANFIC_AUTO_POLISH_HINT } from "./fanfic-ui";

/** The auto-polish switch in the reader, so it can be turned on or off mid-fic without editing the request. */
export function FanficAutoPolishSwitch({ chatId, state, busy }: { chatId: string; state: FanficState; busy: boolean }) {
  const updateMetadata = useUpdateChatMetadata();
  const on = fanficAutoPolishOn(state);
  const toggle = (autoPolish: boolean) => {
    updateMetadata.mutate(
      { id: chatId, fanfic: { ...state, request: { ...state.request, autoPolish } } },
      {
        onError: (error) =>
          toast.error(toUserMessage(error, { fallback: "Couldn't save the polish setting. Try again." })),
      },
    );
  };
  return (
    <label className="flex items-start gap-2 text-sm text-[var(--foreground)]" title={FANFIC_AUTO_POLISH_HINT}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
        checked={on}
        disabled={busy || updateMetadata.isPending}
        onChange={(event) => toggle(event.target.checked)}
      />
      <span>
        Polish each chapter automatically
        <span className="block text-xs text-[var(--muted-foreground)]">
          Cleans up the prose, then fixes continuity and voice slips, after each new chapter.
        </span>
      </span>
    </label>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function stepText(step: FanficPolishStep): string | null {
  if (step.status === "failed") {
    const what = { prose: "clean up the prose", continuity: "check continuity", voice: "check the voices" }[step.step];
    return `couldn't ${what} (${step.error ?? "unknown error"})`;
  }
  if (step.status === "clean" && step.left === 0) return null;
  if (step.step === "prose") return "cleaned up the prose";
  const fixed =
    step.fixed > 0
      ? step.step === "continuity"
        ? `fixed ${plural(step.fixed, "continuity slip", "continuity slips")}`
        : `fixed ${plural(step.fixed, "out-of-character line", "out-of-character lines")}`
      : null;
  const left =
    step.left > 0
      ? `${plural(step.left, step.step === "continuity" ? "slip" : "voice note", step.step === "continuity" ? "slips" : "voice notes")} it couldn't fix (${step.step === "continuity" ? "Check continuity" : "Check voice"} shows ${step.left === 1 ? "it" : "them"})`
      : null;
  return [fixed, left].filter(Boolean).join("; ") || null;
}

/** What the automatic polish did to the version shown: one line under the chapter. */
export function FanficPolishNote({ report }: { report: FanficPolishReport }) {
  const parts = report.steps.map(stepText).filter((part): part is string => part !== null);
  const changed = report.steps.some((step) => step.fixed > 0);
  const failed = report.steps.some((step) => step.status === "failed");
  const text =
    parts.length === 0
      ? "Polished automatically: no AI habits, repeats, continuity slips or out-of-character lines found."
      : `Polished automatically: ${parts.join("; ")}.${changed ? " The chapter as first written is one version back." : ""}`;
  return (
    <p
      role={failed ? "alert" : undefined}
      className="flex items-start gap-1.5 text-xs leading-snug text-[var(--muted-foreground)]"
      data-fanfic-polish-note=""
    >
      <Sparkles size="0.8rem" className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
