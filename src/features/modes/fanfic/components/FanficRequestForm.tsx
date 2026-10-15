import { useMemo, useState, type FormEvent } from "react";
import { Feather, Loader2 } from "lucide-react";
import { useCharacterSummaries } from "../../../catalog/characters/index";
import { useConnections } from "../../../catalog/connections/index";
import {
  FANFIC_POVS,
  FANFIC_RATINGS,
  FANFIC_SETTINGS,
  FANFIC_TENSES,
  FANFIC_WARNINGS,
  type FanficRequest,
} from "../../../../engine/contracts/types/fanfic";
import {
  FANFIC_MAX_CHAPTERS,
  FANFIC_MAX_WORDS_PER_CHAPTER,
  FANFIC_MIN_WORDS_PER_CHAPTER,
  FANFIC_POV_LABELS,
  FANFIC_RATING_LABELS,
  FANFIC_SETTING_LABELS,
  FANFIC_TENSE_LABELS,
  FANFIC_WARNING_LABELS,
  fanficRatingAllowsSexualContent,
  fanficRequestProblems,
  normalizeFanficRequest,
} from "../../../../engine/modes/fanfic/request";
import { TagInput } from "../../../../shared/components/ui/TagInput";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn } from "../../../../shared/lib/utils";
import { FanficButton, FanficField, FanficSection, FanficSegmented, fanficInputClass } from "./fanfic-ui";

const TROPE_SUGGESTIONS = [
  "Slow Burn",
  "Enemies to Lovers",
  "Friends to Lovers",
  "Mutual Pining",
  "Hurt/Comfort",
  "Found Family",
  "Fake Dating",
  "Only One Bed",
  "Fluff",
  "Angst",
  "Angst with a Happy Ending",
  "Fix-It",
  "Time Travel",
  "Soulmates",
  "Domestic",
  "Coffee Shop AU",
  "Modern AU",
  "Royalty AU",
  "Road Trip",
  "Post-Canon",
  "Missing Scene",
  "Pining",
  "Banter",
  "Getting Together",
];

const RATING_DETAIL: Record<FanficRequest["rating"], string> = {
  general: "No sex or gore",
  teen: "Kissing, fade to black",
  mature: "Sex, not graphic",
  explicit: "Graphic allowed",
};

const WORD_OPTIONS = [1000, 1500, 2000, 3000, 4000, 5000];

export interface FanficRequestSubmit {
  request: FanficRequest;
  connectionId: string | null;
  characterIds: string[];
}

interface FanficRequestFormProps {
  initialRequest: FanficRequest;
  initialConnectionId: string | null;
  initialCharacterIds: string[];
  submitting: boolean;
  onSubmit: (value: FanficRequestSubmit) => void;
  /** Shown when editing a request that already has an outline. */
  onCancel?: () => void;
}

function characterName(row: { data?: { name?: string } }): string {
  return row.data?.name?.trim() || "Unnamed";
}

export function FanficRequestForm({
  initialRequest,
  initialConnectionId,
  initialCharacterIds,
  submitting,
  onSubmit,
  onCancel,
}: FanficRequestFormProps) {
  const [request, setRequest] = useState<FanficRequest>(initialRequest);
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId);
  const [characterIds, setCharacterIds] = useState<string[]>(initialCharacterIds);
  const [relationshipDraft, setRelationshipDraft] = useState("");
  const [characterDraft, setCharacterDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [castSearch, setCastSearch] = useState("");
  const { data: connections } = useConnections();
  const { data: characterRows } = useCharacterSummaries(true);

  const languageConnections = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; name?: string; provider?: string }>,
      ),
    [connections],
  );
  const library = useMemo(() => {
    const rows = characterRows ?? [];
    const query = castSearch.trim().toLowerCase();
    const linked = new Set(characterIds);
    return rows
      .filter((row) => linked.has(row.id) || !query || characterName(row).toLowerCase().includes(query))
      .slice(0, query ? 24 : 12);
  }, [castSearch, characterIds, characterRows]);

  const update = <K extends keyof FanficRequest>(key: K, value: FanficRequest[K]) =>
    setRequest((current) => ({ ...current, [key]: value }));
  const normalized = normalizeFanficRequest({
    ...request,
    // Text left in a tag box still counts, so a typed-but-not-added ship is not lost.
    relationships: [...request.relationships, relationshipDraft],
    characters: [...request.characters, characterDraft],
    tags: [...request.tags, tagDraft],
  });
  const problems = fanficRequestProblems(normalized);
  const oneShot = request.chapterCount <= 1;
  const sexualRating = fanficRatingAllowsSexualContent(request.rating);

  const toggleCharacter = (id: string, name: string) => {
    setCharacterIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
    if (!characterIds.includes(id) && !request.characters.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      update("characters", [...request.characters, name]);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    onSubmit({ request: normalized, connectionId: connectionId ?? languageConnections[0]?.id ?? null, characterIds });
  };

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-8" aria-label="Fanfic request">
      <header className="flex items-start gap-3 px-1 pt-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#ffb7c9_0%,#e0607e_55%,#7a2a40_100%)] text-[#fff4f6]">
          <Feather size="1.25rem" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold leading-tight text-[var(--foreground)]">Request a fic</h2>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            Fill this in like an AO3 prompt. You'll get an outline first, then the chapters.
          </p>
        </div>
      </header>

      <FanficSection title="The story">
        <FanficField label="Fandom" htmlFor="fanfic-fandom">
          <input
            id="fanfic-fandom"
            className={fanficInputClass}
            value={request.fandom}
            onChange={(event) => update("fandom", event.target.value)}
            placeholder="Good Omens, Genshin Impact, Star Wars…"
            autoComplete="off"
          />
        </FanficField>
        <FanficField
          label="Prompt"
          htmlFor="fanfic-prompt"
          hint="What should happen? Scenes you want, the vibe, how it ends."
        >
          <textarea
            id="fanfic-prompt"
            className={cn(fanficInputClass, "min-h-28 resize-y leading-relaxed")}
            value={request.prompt}
            onChange={(event) => update("prompt", event.target.value)}
            placeholder="Crowley gets snowed in at the bookshop and neither of them will admit it's on purpose…"
          />
        </FanficField>
      </FanficSection>

      <FanficSection title="Ships & characters" hint="Use A/B for romance and A & B for friendship.">
        <TagInput
          label="Relationships"
          tags={request.relationships}
          inputValue={relationshipDraft}
          onInputChange={setRelationshipDraft}
          onTagsChange={(tags) => update("relationships", tags)}
          placeholder="Aziraphale/Crowley"
          inputAriaLabel="Add a relationship"
          showClearAll={false}
        />
        <TagInput
          label="Characters"
          tags={request.characters}
          inputValue={characterDraft}
          onInputChange={setCharacterDraft}
          onTagsChange={(tags) => update("characters", tags)}
          placeholder="Add a character"
          inputAriaLabel="Add a character"
          showClearAll={false}
        />
        {(characterRows?.length ?? 0) > 0 && (
          <FanficField
            label="Canon notes from your library (optional)"
            htmlFor="fanfic-cast-search"
            hint="Linked cards are sent as reference for voice and history."
          >
            <input
              id="fanfic-cast-search"
              className={fanficInputClass}
              value={castSearch}
              onChange={(event) => setCastSearch(event.target.value)}
              placeholder="Search your characters"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {library.map((row) => {
                const linked = characterIds.includes(row.id);
                const name = characterName(row);
                return (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={linked}
                    onClick={() => toggleCharacter(row.id, name)}
                    className={cn(
                      "min-h-8 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      linked
                        ? "border-[var(--primary)]/60 bg-[var(--primary)]/12 text-[var(--foreground)]"
                        : "border-[var(--border)] bg-[var(--secondary)]/35 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {linked ? "✓ " : "+ "}
                    {name}
                  </button>
                );
              })}
            </div>
          </FanficField>
        )}
      </FanficSection>

      <FanficSection title="Rating & tags">
        <FanficSegmented
          label="Rating"
          value={request.rating}
          onChange={(rating) => update("rating", rating)}
          options={FANFIC_RATINGS.map((rating) => ({
            value: rating,
            label: FANFIC_RATING_LABELS[rating].replace(" And Up Audiences", "").replace(" Audiences", ""),
            detail: RATING_DETAIL[rating],
          }))}
        />
        {sexualRating && (
          <label className="flex items-start gap-2 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/8 p-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
              checked={request.adultsConfirmed}
              onChange={(event) => update("adultsConfirmed", event.target.checked)}
            />
            <span>
              Every character in sexual content is an adult (18+).{" "}
              <span className="text-[var(--muted-foreground)]">
                Characters who are minors in canon get written as adults or kept out of it.
              </span>
            </span>
          </label>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">Archive warnings</legend>
          {FANFIC_WARNINGS.map((warning) => (
            <label key={warning} className="flex min-h-8 items-center gap-2 text-sm text-[var(--foreground)]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={request.warnings.includes(warning)}
                onChange={(event) =>
                  update(
                    "warnings",
                    event.target.checked
                      ? [...request.warnings, warning]
                      : request.warnings.filter((entry) => entry !== warning),
                  )
                }
              />
              {FANFIC_WARNING_LABELS[warning]}
            </label>
          ))}
        </fieldset>
        <TagInput
          label="Tropes & tags"
          tags={request.tags}
          inputValue={tagDraft}
          onInputChange={setTagDraft}
          onTagsChange={(tags) => update("tags", tags)}
          suggestions={TROPE_SUGGESTIONS}
          placeholder="Slow Burn, Hurt/Comfort…"
          inputAriaLabel="Add a trope or tag"
          showClearAll={false}
        />
      </FanficSection>

      <FanficSection title="How it's told">
        <div className="grid gap-3 sm:grid-cols-2">
          <FanficField label="Setting" htmlFor="fanfic-setting">
            <select
              id="fanfic-setting"
              className={fanficInputClass}
              value={request.setting}
              onChange={(event) => update("setting", event.target.value as FanficRequest["setting"])}
            >
              {FANFIC_SETTINGS.map((setting) => (
                <option key={setting} value={setting}>
                  {FANFIC_SETTING_LABELS[setting]}
                </option>
              ))}
            </select>
          </FanficField>
          <FanficField label="Tense" htmlFor="fanfic-tense">
            <select
              id="fanfic-tense"
              className={fanficInputClass}
              value={request.tense}
              onChange={(event) => update("tense", event.target.value as FanficRequest["tense"])}
            >
              {FANFIC_TENSES.map((tense) => (
                <option key={tense} value={tense}>
                  {FANFIC_TENSE_LABELS[tense]}
                </option>
              ))}
            </select>
          </FanficField>
          <FanficField label="Point of view" htmlFor="fanfic-pov">
            <select
              id="fanfic-pov"
              className={fanficInputClass}
              value={request.pov}
              onChange={(event) => update("pov", event.target.value as FanficRequest["pov"])}
            >
              {FANFIC_POVS.map((pov) => (
                <option key={pov} value={pov}>
                  {FANFIC_POV_LABELS[pov]}
                </option>
              ))}
            </select>
          </FanficField>
          <FanficField label="Whose point of view (optional)" htmlFor="fanfic-pov-character">
            <input
              id="fanfic-pov-character"
              className={fanficInputClass}
              value={request.povCharacter}
              onChange={(event) => update("povCharacter", event.target.value)}
              placeholder="Crowley"
              autoComplete="off"
            />
          </FanficField>
        </div>
        {request.setting !== "canon" && (
          <FanficField label="What's different from canon" htmlFor="fanfic-setting-notes">
            <textarea
              id="fanfic-setting-notes"
              className={cn(fanficInputClass, "min-h-16 resize-y")}
              value={request.settingNotes}
              onChange={(event) => update("settingNotes", event.target.value)}
              placeholder="Everyone survives the finale. / They run a bakery in 2020s London."
            />
          </FanficField>
        )}
        <FanficField
          label="Style (optional)"
          htmlFor="fanfic-style"
          hint="Describe the voice you like, or paste a short sample to match."
        >
          <textarea
            id="fanfic-style"
            className={cn(fanficInputClass, "min-h-16 resize-y")}
            value={request.styleNotes}
            onChange={(event) => update("styleNotes", event.target.value)}
            placeholder="Dry humor, lots of banter, short punchy paragraphs."
          />
        </FanficField>
      </FanficSection>

      <FanficSection title="Length">
        <FanficSegmented
          label="Length"
          value={oneShot ? "oneshot" : "multi"}
          onChange={(value) => update("chapterCount", value === "oneshot" ? 1 : Math.max(2, request.chapterCount))}
          options={[
            { value: "oneshot", label: "One-shot", detail: "A single chapter" },
            { value: "multi", label: "Multi-chapter", detail: "Read as it's written" },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {!oneShot && (
            <FanficField label="Chapters" htmlFor="fanfic-chapters">
              <input
                id="fanfic-chapters"
                type="number"
                inputMode="numeric"
                min={2}
                max={FANFIC_MAX_CHAPTERS}
                className={fanficInputClass}
                value={request.chapterCount}
                onChange={(event) => update("chapterCount", Number(event.target.value) || 2)}
              />
            </FanficField>
          )}
          <FanficField label="Words per chapter" htmlFor="fanfic-words">
            <select
              id="fanfic-words"
              className={fanficInputClass}
              value={request.wordsPerChapter}
              onChange={(event) => update("wordsPerChapter", Number(event.target.value))}
            >
              {WORD_OPTIONS.filter(
                (words) => words >= FANFIC_MIN_WORDS_PER_CHAPTER && words <= FANFIC_MAX_WORDS_PER_CHAPTER,
              ).map((words) => (
                <option key={words} value={words}>
                  About {words.toLocaleString()} words
                </option>
              ))}
            </select>
          </FanficField>
        </div>
        <label className="flex min-h-8 items-center gap-2 text-sm text-[var(--foreground)]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--primary)]"
            checked={request.reviewOutline}
            onChange={(event) => update("reviewOutline", event.target.checked)}
          />
          Show me the outline before chapter 1
        </label>
        {languageConnections.length > 1 && (
          <FanficField label="Model connection" htmlFor="fanfic-connection">
            <select
              id="fanfic-connection"
              className={fanficInputClass}
              value={connectionId ?? ""}
              onChange={(event) => setConnectionId(event.target.value || null)}
            >
              {!connectionId && <option value="">Choose a connection</option>}
              {languageConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name || connection.id}
                </option>
              ))}
            </select>
          </FanficField>
        )}
      </FanficSection>

      {showProblems && problems.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/35 bg-red-500/10 p-3 text-sm text-[var(--foreground)]"
        >
          <p className="font-semibold">Almost there:</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/95 to-transparent px-1 pb-1 pt-4">
        {onCancel && (
          <FanficButton onClick={onCancel} disabled={submitting} className="min-h-11">
            Keep current plan
          </FanficButton>
        )}
        <FanficButton type="submit" tone="primary" disabled={submitting} className="min-h-11 px-5">
          {submitting ? <Loader2 size="1rem" className="animate-spin" aria-hidden="true" /> : null}
          {request.reviewOutline ? "Plan my fic" : "Start writing"}
        </FanficButton>
      </div>
    </form>
  );
}
