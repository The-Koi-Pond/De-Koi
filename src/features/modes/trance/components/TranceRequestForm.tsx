import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Orbit } from "lucide-react";
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
  type TranceRequest,
} from "../../../../engine/contracts/types/trance";
import {
  TRANCE_CATEGORY_LABELS,
  TRANCE_ENDING_LABELS,
  TRANCE_FEATURE_LABELS,
  TRANCE_MOOD_LABELS,
  TRANCE_NOTE_LIMIT,
  TRANCE_TYPE_LABELS,
  tranceFeaturesForType,
} from "../../../../engine/modes/trance/request";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn } from "../../../../shared/lib/utils";

export interface TranceRequestSubmit {
  request: TranceRequest;
  connectionId: string | null;
  characterId: string;
}

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

function characterName(row: { data?: { name?: string } }): string {
  return row.data?.name?.trim() || "Unnamed";
}

export function TranceRequestForm({
  initial,
  initialCharacterId,
  initialConnectionId,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: TranceRequest;
  initialCharacterId: string | null;
  initialConnectionId: string | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (submit: TranceRequestSubmit) => void;
  onCancel?: () => void;
}) {
  const [request, setRequest] = useState<TranceRequest>(initial);
  const [characterId, setCharacterId] = useState(initialCharacterId ?? "");
  const [characterFilter, setCharacterFilter] = useState("");
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? "");
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
  const canSubmit = !!characterId && !!effectiveConnectionId && !submitting;

  const update = (patch: Partial<TranceRequest>) => setRequest((current) => ({ ...current, ...patch }));
  const setCategory = (category: TranceCategory) =>
    update({ category, ...(category === "sleep" ? { ending: "sleep" as const } : {}) });
  const toggleFeature = (feature: TranceFeature) =>
    update({
      features: request.features.includes(feature)
        ? request.features.filter((item) => item !== feature)
        : [...request.features, feature],
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      request: { ...request, features: tranceFeaturesForType(request.type, request.features) },
      connectionId: effectiveConnectionId,
      characterId,
    });
  };

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-4 sm:px-4">
      <header className="flex items-center gap-2 px-1">
        <Orbit size="1.25rem" className="text-[var(--primary)]" aria-hidden="true" />
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">New trance session</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Pick who guides you and how it should feel. You'll read it one line at a time.
          </p>
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

      <Section title="How are you feeling?" hint="Optional. The session starts from where you are.">
        <ChipRow label="Right now">
          {TRANCE_MOODS.map((mood) => (
            <Chip
              key={mood}
              selected={request.mood === mood}
              onClick={() => update({ mood: request.mood === mood ? "" : mood })}
            >
              {TRANCE_MOOD_LABELS[mood]}
            </Chip>
          ))}
        </ChipRow>
        <textarea
          className={cn(inputClass, "min-h-[4rem] resize-y")}
          placeholder="Anything else about today? (optional)"
          aria-label="Anything else about how you feel"
          maxLength={TRANCE_NOTE_LIMIT}
          value={request.moodNote}
          onChange={(event) => update({ moodNote: event.target.value })}
        />
      </Section>

      <Section title="The session">
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
      </Section>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--foreground)]"
        >
          {error}
        </p>
      )}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 bg-[var(--background)]/90 py-2 backdrop-blur">
        {!characterId && (
          <span className="mr-auto text-xs text-[var(--muted-foreground)]">Pick a character first.</span>
        )}
        {characterId && !effectiveConnectionId && (
          <span className="mr-auto text-xs text-[var(--muted-foreground)]">Pick a model connection first.</span>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {submitting && <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />}
          Write my session
        </button>
      </div>
    </form>
  );
}
