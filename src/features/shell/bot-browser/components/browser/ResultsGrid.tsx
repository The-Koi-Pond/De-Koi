import { ChevronLeft, ChevronRight } from "lucide-react";

import { shortNumber } from "../../lib/format-stats";
import type { BrowserCard } from "../../lib/providers/types";
import { CardPicture, STAT_ICONS } from "./CardPicture";

function CardTile({ card, onOpen }: { card: BrowserCard; onOpen: (card: BrowserCard) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] text-left transition-colors hover:border-[var(--primary)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span className="relative block aspect-[3/4] w-full overflow-hidden bg-[var(--muted)]">
        <CardPicture src={card.picture} alt={card.name} className="h-full w-full" />
        {card.nsfw && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[0.625rem] font-bold text-white">
            NSFW
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
        <span className="truncate text-sm font-semibold text-[var(--foreground)]">{card.name}</span>
        {card.creator && <span className="truncate text-xs text-[var(--muted-foreground)]">by {card.creator}</span>}
        {card.tagline && <span className="line-clamp-2 text-xs text-[var(--foreground)]/80">{card.tagline}</span>}
        {card.stats.length > 0 && (
          <span className="mt-auto flex flex-wrap gap-x-2.5 gap-y-1 pt-1 text-xs text-[var(--muted-foreground)]">
            {card.stats.map((stat) => {
              const Icon = STAT_ICONS[stat.icon];
              return (
                <span key={stat.label} title={stat.label} className="flex items-center gap-1">
                  <Icon size="0.75rem" aria-hidden="true" />
                  {shortNumber(stat.value)}
                  <span className="sr-only"> {stat.label}</span>
                </span>
              );
            })}
          </span>
        )}
      </span>
    </button>
  );
}

export function ResultsGrid({ cards, onOpen }: { cards: BrowserCard[]; onOpen: (card: BrowserCard) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6">
      {cards.map((card, index) => (
        <li key={`${card.id}-${index}`} className="flex min-w-0">
          <CardTile card={card} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

/** Previous, the page number and Next. Next stops at the last page and on a page that came back empty. */
export function Pager({
  page,
  pages,
  pageEmpty,
  onPage,
}: {
  page: number;
  pages: number;
  pageEmpty: boolean;
  onPage: (page: number) => void;
}) {
  if (pages <= 1 && page <= 1) return null;
  const nextDisabled = (page >= pages && pages > 1) || pageEmpty;
  const buttonClass =
    "flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-3 py-4">
      <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size="0.875rem" aria-hidden="true" />
        Previous
      </button>
      <span className="text-sm text-[var(--muted-foreground)]">
        Page {page}
        {pages >= 2 && pages <= 8999 ? ` of ${pages}` : ""}
      </span>
      <button type="button" className={buttonClass} disabled={nextDisabled} onClick={() => onPage(page + 1)}>
        Next
        <ChevronRight size="0.875rem" aria-hidden="true" />
      </button>
    </nav>
  );
}
