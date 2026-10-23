import { Hourglass, X } from "lucide-react";
import { toast } from "sonner";

import type { WorldTickOffer } from "../../../../engine/contracts/types/roleplay-world-tick";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useWorldTick } from "../hooks/use-world-tick";

/** What the offer is about, in one line. */
export function worldTickOfferText(offer: WorldTickOffer): string {
  if (offer.trigger === "scene_concluded") {
    return `“${offer.label}” ended. Let time pass before the story picks up?`;
  }
  return `You skipped ahead (${offer.label}). Fill in what happened off-screen meanwhile?`;
}

/**
 * Shown above the message box when a scene ended or the user's message skipped ahead. Taking it
 * opens the usual review; nothing is suggested or added until the user asks for it there.
 */
export function RoleplayWorldTickOfferBar({
  chatId,
  offer,
  onOpen,
}: {
  chatId: string;
  offer: WorldTickOffer;
  onOpen: () => void;
}) {
  const worldTick = useWorldTick(chatId);
  const busy = worldTick.command.isPending;
  const dismiss = () =>
    worldTick.command.mutate(
      { command: { type: "dismiss_offer", offerId: offer.id } },
      { onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't hide the offer. Try again." })) },
    );
  const turnOff = () =>
    worldTick.command.mutate(
      { command: { type: "set_offers_enabled", enabled: false } },
      {
        onSuccess: () => toast.success("Won't offer in this chat. Turn it back on from Let time pass."),
        onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't turn offers off. Try again." })),
      },
    );

  return (
    <div
      role="status"
      className="mb-1.5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 px-3 py-2 text-xs text-[var(--card-foreground)] shadow-sm backdrop-blur"
    >
      <Hourglass size="0.875rem" className="shrink-0 text-lime-400" aria-hidden="true" />
      {/* Keeps the sentence readable on a phone: the buttons wrap below it instead of squeezing it. */}
      <span className="min-w-[12rem] flex-1 leading-snug">{worldTickOfferText(offer)}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="rounded-lg bg-[var(--primary)] px-2.5 py-1 font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
        >
          Let time pass
        </button>
        <button
          type="button"
          onClick={turnOff}
          disabled={busy}
          className="rounded-lg px-2 py-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          Don't offer here
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          aria-label="Not now"
          title="Not now"
          className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          <X size="0.875rem" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
