import { ArrowLeft, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useId, type ReactNode } from "react";

import { hasLorebookEntries } from "../../../../../shared/lib/character-import";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import type { OpenCharacter } from "../../hooks/use-open-character";
import type { TagImportMode } from "../../lib/importing";
import { CardPicture, STAT_ICONS } from "./CardPicture";

const TAG_MODES: Array<{ value: TagImportMode; label: string; hint: string }> = [
  { value: "all", label: "All tags", hint: "Keep source tags." },
  { value: "none", label: "No tags", hint: "Skip source tags." },
  { value: "existing", label: "Existing only", hint: "Keep tags already in De-Koi." },
];

const NO_PICTURE_REASON = "This character has no picture to build a PNG from.";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h3>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--secondary)] p-3 text-sm leading-relaxed text-[var(--foreground)]">
      {text}
    </div>
  );
}

const actionClass =
  "flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function CharacterDetailView({
  open,
  tagImportMode,
  onTagImportModeChange,
  importing,
  downloading,
  onBack,
  onRetry,
  onImport,
  onDownloadPng,
  onOpenLink,
}: {
  open: OpenCharacter;
  tagImportMode: TagImportMode;
  onTagImportModeChange: (mode: TagImportMode) => void;
  importing: boolean;
  downloading: boolean;
  onBack: () => void;
  onRetry: () => void;
  onImport: () => void;
  onDownloadPng: () => void;
  onOpenLink: () => void;
}) {
  const { card, provider } = open;
  const tagModeName = useId();
  const noPictureId = useId();
  const detail = open.status === "ready" ? open.detail : null;

  const lorebookNote = (() => {
    if (!detail) return null;
    if (hasLorebookEntries(detail.embeddedLorebook)) return "Has embedded lorebook";
    if (!detail.hasLorebook) return null;
    // A built import only carries a lorebook that came with the detail; the PNG card brings its own (decision 11).
    return provider.importKind === "png"
      ? "Has embedded lorebook"
      : `Has a lorebook on ${provider.site} (not imported)`;
  })();

  return (
    <article aria-label={card.name} className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
        >
          <ArrowLeft size="0.875rem" aria-hidden="true" />
          Back to results
        </button>
        <a
          href={card.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            onOpenLink();
          }}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-[var(--primary)] hover:bg-[var(--accent)]"
        >
          View on {provider.site}
          <ExternalLink size="0.8125rem" aria-hidden="true" />
        </a>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <CardPicture
            src={card.picture}
            alt={card.name}
            loading="eager"
            className="aspect-[3/4] w-full rounded-lg border border-[var(--border)]"
          />

          {open.status !== "error" && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-semibold text-[var(--muted-foreground)]">Imported tags</legend>
                {TAG_MODES.map((mode) => (
                  <label
                    key={mode.value}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <input
                      type="radio"
                      name={tagModeName}
                      value={mode.value}
                      checked={tagImportMode === mode.value}
                      onChange={() => onTagImportModeChange(mode.value)}
                      className="mt-1 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="block font-medium">{mode.label}</span>
                      <span className="block text-xs text-[var(--muted-foreground)]">{mode.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <button
                type="button"
                onClick={onImport}
                disabled={importing}
                className={`${actionClass} bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90`}
              >
                {importing && <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />}
                {importing ? "Importing..." : "Import"}
              </button>
              <button
                type="button"
                onClick={onDownloadPng}
                disabled={downloading || !card.picture}
                aria-describedby={card.picture ? undefined : noPictureId}
                className={`${actionClass} border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)]`}
              >
                {downloading ? (
                  <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download size="0.875rem" aria-hidden="true" />
                )}
                {downloading ? "Building PNG..." : "Download as PNG"}
              </button>
              {!card.picture && (
                <p id={noPictureId} className="text-xs text-[var(--muted-foreground)]">
                  {NO_PICTURE_REASON}
                </p>
              )}
            </>
          )}

          {card.stats.length > 0 && (
            <ul className="space-y-1 text-sm text-[var(--muted-foreground)]">
              {card.stats.map((stat) => {
                const Icon = STAT_ICONS[stat.icon];
                return (
                  <li key={stat.label} className="flex items-center gap-2">
                    <Icon size="0.875rem" aria-hidden="true" />
                    {stat.value.toLocaleString("en-US")} {stat.label.toLowerCase()}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <header className="space-y-1">
            <h2 className="text-xl font-bold text-[var(--foreground)]">{card.name}</h2>
            {card.creator && <p className="text-sm text-[var(--muted-foreground)]">by {card.creator}</p>}
            {card.tagline && <p className="text-sm text-[var(--foreground)]/85">{card.tagline}</p>}
            {card.tags.length > 0 && (
              <ul aria-label="Tags" className="flex flex-wrap gap-1 pt-1">
                {card.tags.slice(0, 20).map((tag, index) => (
                  <li
                    key={`${index}-${tag}`}
                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </header>

          {open.status === "loading" && (
            <div role="status" className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
              <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />
              Loading character...
            </div>
          )}

          {open.status === "error" && (
            <div role="alert" className="space-y-3 rounded-md border border-[var(--destructive)]/40 p-4">
              <p className="text-sm text-[var(--foreground)]">
                {toUserMessage(open.error, {
                  fallback: "Couldn't load this character. Check your internet connection, then try again.",
                })}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
              >
                <RefreshCw size="0.8125rem" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          {open.status === "ready" && !detail && (
            <p className="text-sm text-[var(--muted-foreground)]">
              No detailed definition available. You can still import this character with basic info.
            </p>
          )}

          {detail && (
            <>
              {detail.creatorNotes && (
                <Section title="Creator's notes">
                  <Prose text={detail.creatorNotes} />
                </Section>
              )}
              {detail.description && (
                <Section title="Description / personality">
                  <Prose text={detail.description} />
                </Section>
              )}
              {detail.personality && (
                <Section title="Personality">
                  <Prose text={detail.personality} />
                </Section>
              )}
              {detail.scenario && (
                <Section title="Scenario">
                  <Prose text={detail.scenario} />
                </Section>
              )}
              {detail.firstMessage && (
                <Section title="First message">
                  <Prose text={detail.firstMessage} />
                </Section>
              )}
              {detail.alternateGreetings && detail.alternateGreetings.length > 0 && (
                <Section title={`Alternate greetings (${detail.alternateGreetings.length})`}>
                  <div className="space-y-2">
                    {detail.alternateGreetings.map((greeting, index) => (
                      <Prose key={index} text={greeting} />
                    ))}
                  </div>
                </Section>
              )}
              {detail.exampleDialogs && (
                <Section title="Example dialogues">
                  <Prose text={detail.exampleDialogs} />
                </Section>
              )}
              {lorebookNote && <p className="text-sm font-medium text-[var(--foreground)]">{lorebookNote}</p>}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
