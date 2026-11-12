import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Eye, Loader2, Orbit, Sparkles, Wand2 } from "lucide-react";
import { useCharacterSummaries } from "../../../catalog/characters/index";
import { useConnections } from "../../../catalog/connections/index";
import {
  TRANCE_CATEGORIES,
  TRANCE_ENDINGS,
  TRANCE_FEATURES,
  TRANCE_LENGTHS,
  TRANCE_MOODS,
  TRANCE_SEXUAL_FEATURES,
  TRANCE_TYPES,
  type TranceCategory,
  type TranceFeature,
  type TranceMood,
  type TranceRequest,
} from "../../../../engine/contracts/types/trance";
import type { TrancePitch } from "../../../../engine/modes/trance/pitches";
import {
  TRANCE_CATEGORY_LABELS,
  TRANCE_ENDING_LABELS,
  TRANCE_FEATURE_LABELS,
  TRANCE_MOOD_LABELS,
  TRANCE_NOTE_LIMIT,
  TRANCE_TYPE_LABELS,
  quickTranceRequest,
  tranceFeaturesForType,
  tranceTagSummary,
} from "../../../../engine/modes/trance/request";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { cn } from "../../../../shared/lib/utils";
import { useTrancePitches } from "../hooks/use-trance";
import { TrancePitchCard } from "./TrancePitchCard";

export interface TranceRequestSubmit {
  request: TranceRequest;
  connectionId: string | null;
  characterId: string;
}

/** How the person wants to set the session up: no choices, pick from ideas, or build it. */
export type TranceSetupPath = "ideas" | "build";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)]/45 px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/70 focus:border-[var(--primary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/25";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-[var(--foreground)]">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">{hint}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Chip({
  selected,
  disabled,
  onClick,
  children,
  title,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "border-[var(--primary)] bg-[var(--primary)]/15 font-semibold text-[var(--foreground)]"
          : "border-[var(--border)] bg-[var(--secondary)]/40 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

function PathButton({
  selected,
  primary,
  icon,
  title,
  detail,
  disabled,
  onClick,
}: {
  selected?: boolean;
  primary?: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  // A disabled main path keeps the plain look: a dimmed orange fill read as "already picked".
  const filled = primary && !disabled;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        filled
          ? "border-[var(--primary)] bg-[var(--primary)] hover:brightness-110"
          : selected
            ? "border-[var(--primary)] bg-[var(--primary)]/10"
            : "border-[var(--border)] bg-[var(--secondary)]/30 hover:bg-[var(--secondary)]/60",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", filled ? "text-[var(--primary-foreground)]" : "text-[var(--primary)]")}>
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-sm font-bold",
            filled ? "text-[var(--primary-foreground)]" : "text-[var(--foreground)]",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "block text-xs leading-snug",
            filled ? "text-[var(--primary-foreground)]/80" : "text-[var(--muted-foreground)]",
          )}
        >
          {detail}
        </span>
      </span>
    </button>
  );
}

function characterName(row: { data?: { name?: string } }): string {
  return row.data?.name?.trim() || "Unnamed";
}

function pitchError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  return toUserMessage(error, { fallback: "That didn't work. Try again." });
}

export function TranceRequestForm({
  initial,
  initialCharacterId,
  initialConnectionId,
  initialPath = null,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: TranceRequest;
  initialCharacterId: string | null;
  initialConnectionId: string | null;
  initialPath?: TranceSetupPath | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (submit: TranceRequestSubmit) => void;
  onCancel?: () => void;
}) {
  const [request, setRequest] = useState<TranceRequest>({ ...initial, pitch: null });
  const [characterId, setCharacterId] = useState(initialCharacterId ?? "");
  const [characterFilter, setCharacterFilter] = useState("");
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? "");
  const [path, setPath] = useState<TranceSetupPath | null>(initialPath);
  const [ownWords, setOwnWords] = useState(!!initial.moodNote);
  const [ideas, setIdeas] = useState<TrancePitch[]>([]);
  const [preview, setPreview] = useState<TrancePitch | null>(null);
  const suggest = useTrancePitches();
  const pathSection = useRef<HTMLDivElement | null>(null);
  // Opening ideas or the builder brings it into view; on a phone it would otherwise start below the fold.
  useEffect(() => {
    if (path) pathSection.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [path]);
  const { data: connectionRows } = useConnections();
  const { data: characterRows } = useCharacterSummaries(true);

  const connections = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connectionRows ?? []) as Array<{ id: string; name?: string; provider?: string }>,
      ),
    [connectionRows],
  );
  const characters = useMemo(() => {
    const rows = ((characterRows ?? []) as Array<{ id: string; data?: { name?: string } }>).map((row) => ({
      id: row.id,
      name: characterName(row),
    }));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [characterRows]);
  const filteredCharacters = useMemo(() => {
    const query = characterFilter.trim().toLowerCase();
    if (!query) return characters;
    return characters.filter((row) => row.id === characterId || row.name.toLowerCase().includes(query));
  }, [characterFilter, characterId, characters]);

  const effectiveConnectionId = connectionId || (connections.length === 1 ? connections[0]!.id : "");
  const ready = !!characterId && !!effectiveConnectionId;
  const busy = submitting || suggest.isPending;
  const quick = quickTranceRequest({ moods: request.moods, moodNote: request.moodNote, now: new Date() });

  // A change to the settings makes an earlier preview stale.
  const update = (patch: Partial<TranceRequest>) => {
    setPreview(null);
    setRequest((current) => ({ ...current, ...patch }));
  };
  const toggleMood = (mood: TranceMood) =>
    setRequest((current) => ({
      ...current,
      moods: current.moods.includes(mood) ? current.moods.filter((item) => item !== mood) : [...current.moods, mood],
    }));
  const setCategory = (category: TranceCategory) =>
    update({ category, ...(category === "sleep" ? { ending: "sleep" as const } : {}) });
  const toggleFeature = (feature: TranceFeature) =>
    update({
      features: request.features.includes(feature)
        ? request.features.filter((item) => item !== feature)
        : [...request.features, feature],
    });

  const send = (next: TranceRequest) => {
    if (!ready || busy) return;
    onSubmit({ request: next, connectionId: effectiveConnectionId, characterId });
  };
  const built = (): TranceRequest => ({
    ...request,
    features: tranceFeaturesForType(request.type, request.features),
    pitch: null,
  });
  const askForIdeas = (more: boolean) => {
    if (!ready) return;
    setPath("ideas");
    if (!more) setIdeas([]);
    suggest.mutate(
      {
        connectionId: effectiveConnectionId,
        characterId,
        moods: request.moods,
        moodNote: request.moodNote,
        idea: request.idea,
        avoidTitles: more ? ideas.map((pitch) => pitch.title) : [],
      },
      { onSuccess: setIdeas },
    );
  };
  const askForPreview = () => {
    if (!ready) return;
    setPreview(null);
    suggest.mutate(
      {
        connectionId: effectiveConnectionId,
        characterId,
        moods: request.moods,
        moodNote: request.moodNote,
        idea: request.idea,
        exact: built(),
      },
      { onSuccess: (pitches) => setPreview(pitches[0] ?? null) },
    );
  };
  const tweak = (pitch: TrancePitch) => {
    setRequest({ ...pitch.request, moods: request.moods, moodNote: request.moodNote, pitch: null });
    setPreview(null);
    setPath("build");
  };
  const shownError = pitchError(suggest.error) ?? error;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-4 sm:px-4">
      <header className="flex items-center gap-2 px-1">
        <Orbit size="1.25rem" className="text-[var(--primary)]" aria-hidden="true" />
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">New trance session</h2>
          <p className="text-xs text-[var(--muted-foreground)]">You'll read it one line at a time.</p>
        </div>
      </header>

      <Section title="Who guides you">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="trance-character" className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
            Character
          </label>
          {characters.length > 12 && (
            <input
              type="search"
              className={inputClass}
              placeholder="Filter characters"
              aria-label="Filter characters"
              value={characterFilter}
              onChange={(event) => setCharacterFilter(event.target.value)}
            />
          )}
          <select
            id="trance-character"
            className={inputClass}
            value={characterId}
            onChange={(event) => setCharacterId(event.target.value)}
          >
            <option value="">Choose a character</option>
            {filteredCharacters.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        {connections.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trance-connection" className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
              Model connection
            </label>
            <select
              id="trance-connection"
              className={inputClass}
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
            >
              <option value="">Choose a connection</option>
              {connections.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name || row.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </Section>

      <Section title="How are you feeling?" hint="Pick any that fit, say it in your own words, or skip it.">
        <div role="group" aria-label="How you feel" className="flex flex-wrap gap-1.5">
          {TRANCE_MOODS.map((mood) => (
            <Chip key={mood} selected={request.moods.includes(mood)} onClick={() => toggleMood(mood)}>
              {TRANCE_MOOD_LABELS[mood]}
            </Chip>
          ))}
          <Chip selected={ownWords} onClick={() => setOwnWords(!ownWords)}>
            Something else…
          </Chip>
        </div>
        {(ownWords || request.moodNote) && (
          <textarea
            className={cn(inputClass, "min-h-[4rem] resize-y")}
            placeholder="In your own words, however it comes out"
            aria-label="How you feel, in your own words"
            maxLength={TRANCE_NOTE_LIMIT}
            value={request.moodNote}
            onChange={(event) => setRequest((current) => ({ ...current, moodNote: event.target.value }))}
          />
        )}
      </Section>

      <Section title="How do you want to do this?">
        <div className="flex flex-col gap-2 sm:flex-row">
          <PathButton
            primary
            icon={
              submitting && !path ? <Loader2 size="1.125rem" className="animate-spin" /> : <Sparkles size="1.125rem" />
            }
            title="Just put me under"
            detail={`No choices. ${tranceTagSummary(quick)}, about ${quick.minutes} min, ${TRANCE_ENDING_LABELS[quick.ending].toLowerCase()}.`}
            disabled={!ready || busy}
            onClick={() => send(quick)}
          />
          <PathButton
            selected={path === "ideas"}
            icon={<Eye size="1.125rem" />}
            title="Help me choose"
            detail="See three ideas with a taste of each, then pick one."
            disabled={!ready || busy}
            onClick={() => askForIdeas(false)}
          />
          <PathButton
            selected={path === "build"}
            icon={<Wand2 size="1.125rem" />}
            title="I'll build it"
            detail="Pick the type, features, length and ending yourself."
            disabled={busy}
            onClick={() => setPath("build")}
          />
        </div>
        {!characterId && <p className="text-xs text-[var(--muted-foreground)]">Pick a character first.</p>}
        {characterId && !effectiveConnectionId && (
          <p className="text-xs text-[var(--muted-foreground)]">Pick a model connection first.</p>
        )}
      </Section>

      <div ref={pathSection} className="scroll-mt-2" />
      {path === "ideas" && (
        <Section title="Ideas" hint="Each one shows how it would open.">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trance-ideas-idea" className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
              Anything you'd like in it? (optional)
            </label>
            <input
              id="trance-ideas-idea"
              className={inputClass}
              placeholder="A place, an image, a feeling…"
              maxLength={TRANCE_NOTE_LIMIT}
              value={request.idea}
              onChange={(event) => setRequest((current) => ({ ...current, idea: event.target.value }))}
            />
          </div>
          {suggest.isPending && (
            <div role="status" className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />
              Thinking up a few ideas…
              <button type="button" onClick={suggest.stop} className="ml-auto text-xs hover:text-[var(--foreground)]">
                Stop
              </button>
            </div>
          )}
          {ideas.map((pitch) => (
            <TrancePitchCard
              key={pitch.title}
              pitch={pitch}
              disabled={!ready || busy}
              onWrite={() => send(pitch.request)}
              onTweak={() => tweak(pitch)}
            />
          ))}
          {!suggest.isPending && (
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => askForIdeas(ideas.length > 0)}
              className="self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] disabled:opacity-50"
            >
              {ideas.length > 0 ? "Show me others" : "Suggest ideas"}
            </button>
          )}
        </Section>
      )}

      {path === "build" && (
        <Section title="Build it">
          <ChipRow label="Type">
            {TRANCE_TYPES.map((type) => (
              <Chip key={type} selected={request.type === type} onClick={() => update({ type })}>
                {TRANCE_TYPE_LABELS[type]}
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label="Category">
            {TRANCE_CATEGORIES.map((category) => (
              <Chip key={category} selected={request.category === category} onClick={() => setCategory(category)}>
                {TRANCE_CATEGORY_LABELS[category]}
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label="Features">
            {TRANCE_FEATURES.map((feature) => {
              const needsSpicy = request.type === "gentle" && TRANCE_SEXUAL_FEATURES.includes(feature);
              return (
                <Chip
                  key={feature}
                  selected={request.features.includes(feature) && !needsSpicy}
                  disabled={needsSpicy}
                  title={needsSpicy ? "Pick Erotic or Kinky for this one" : undefined}
                  onClick={() => toggleFeature(feature)}
                >
                  {TRANCE_FEATURE_LABELS[feature]}
                </Chip>
              );
            })}
          </ChipRow>
          <ChipRow label="Length">
            {TRANCE_LENGTHS.map((minutes) => (
              <Chip key={minutes} selected={request.minutes === minutes} onClick={() => update({ minutes })}>
                {minutes} min
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label="Ending">
            {TRANCE_ENDINGS.map((ending) => (
              <Chip key={ending} selected={request.ending === ending} onClick={() => update({ ending })}>
                {TRANCE_ENDING_LABELS[ending]}
              </Chip>
            ))}
          </ChipRow>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trance-idea" className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
              Idea (optional)
            </label>
            <textarea
              id="trance-idea"
              className={cn(inputClass, "min-h-[4rem] resize-y")}
              placeholder="A theme or image, like “a puppet put away in a box for safekeeping”"
              maxLength={TRANCE_NOTE_LIMIT}
              value={request.idea}
              onChange={(event) => update({ idea: event.target.value })}
            />
          </div>
          {suggest.isPending && (
            <div role="status" className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />
              Writing a taste of it…
              <button type="button" onClick={suggest.stop} className="ml-auto text-xs hover:text-[var(--foreground)]">
                Stop
              </button>
            </div>
          )}
          {preview && (
            <TrancePitchCard pitch={preview} disabled={!ready || busy} onWrite={() => send(preview.request)} />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="mr-auto rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              disabled={!ready || busy}
              onClick={askForPreview}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
            >
              <Eye size="1rem" aria-hidden="true" />
              Preview
            </button>
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => send(built())}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {submitting && <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />}
              Write my session
            </button>
          </div>
        </Section>
      )}

      {path !== "build" && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="self-end rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Cancel
        </button>
      )}

      {shownError && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--foreground)]"
        >
          {shownError}
        </p>
      )}
    </div>
  );
}
