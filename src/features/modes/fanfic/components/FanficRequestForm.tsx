import { useMemo, useState, type FormEvent } from "react";
import { BookOpen, BookUser, Feather, Loader2, X } from "lucide-react";
import { useCharacterSummaries } from "../../../catalog/characters/index";
import { useConnections } from "../../../catalog/connections/index";
import { useLorebooks } from "../../../catalog/lorebooks/index";
import { useActivePersonaSummary } from "../../../catalog/personas/index";
import type { Lorebook } from "../../../../engine/contracts/types/lorebook";
import {
  activeLorebookScopeReasonLabels,
  lorebookCanBeSelectedForContext,
  resolveActiveLorebookScopeReasons,
} from "../../../../engine/generation-core/lorebooks/active-lorebook-scope";
import { parseRecord } from "../../../../engine/generation/runtime-records";
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
import { useUIStore } from "../../../../shared/stores/ui.store";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn } from "../../../../shared/lib/utils";
import { FanficCombobox, type FanficComboOption } from "./FanficCombobox";
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

/** The presets plus a saved value that isn't one of them, so the select never renders blank. */
function wordOptions(current: number): number[] {
  const options = WORD_OPTIONS.filter(
    (words) => words >= FANFIC_MIN_WORDS_PER_CHAPTER && words <= FANFIC_MAX_WORDS_PER_CHAPTER,
  );
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

export interface FanficRequestSubmit {
  request: FanficRequest;
  connectionId: string | null;
  characterIds: string[];
  lorebookIds: string[];
}

/** The lorebooks picked for this chat (`metadata.activeLorebookIds`). */
export function fanficPickedLorebookIds(metadata: unknown): string[] {
  const ids = parseRecord(metadata).activeLorebookIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && !!id.trim()) : [];
}

const MAX_PICKS_SHOWN = 6;

const LORE_REASON_TEXT: Record<string, string> = {
  Global: "On everywhere",
  Character: "From a linked card",
  Persona: "From your persona",
  Chat: "Tied to this fic",
};

interface FanficRequestFormProps {
  chatId: string;
  /** The chat's own persona; lorebooks tied to it (or to the active persona when unset) apply too. */
  chatPersonaId: string | null;
  initialRequest: FanficRequest;
  initialConnectionId: string | null;
  initialCharacterIds: string[];
  initialLorebookIds: string[];
  submitting: boolean;
  /** Why the last save failed; nothing was half-saved. */
  submitError?: string | null;
  onSubmit: (value: FanficRequestSubmit) => void;
  /** Shown when editing a request that already has an outline. */
  onCancel?: () => void;
}

function characterName(row: { data?: { name?: string } }): string {
  return row.data?.name?.trim() || "Unnamed";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function FanficRequestForm({
  chatId,
  chatPersonaId,
  initialRequest,
  initialConnectionId,
  initialCharacterIds,
  initialLorebookIds,
  submitting,
  submitError = null,
  onSubmit,
  onCancel,
}: FanficRequestFormProps) {
  const [request, setRequest] = useState<FanficRequest>(initialRequest);
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId);
  const [characterIds, setCharacterIds] = useState<string[]>(initialCharacterIds);
  const [lorebookIds, setLorebookIds] = useState<string[]>(initialLorebookIds);
  const [lorebookSearch, setLorebookSearch] = useState("");
  const [relationshipDraft, setRelationshipDraft] = useState("");
  const [characterDraft, setCharacterDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const { data: connections } = useConnections();
  const { data: characterRows } = useCharacterSummaries(true);
  const { data: lorebookRows } = useLorebooks();
  const { data: activePersona } = useActivePersonaSummary(!chatPersonaId);
  const personaId = chatPersonaId || activePersona?.id || null;

  const languageConnections = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; name?: string; provider?: string }>,
      ),
    [connections],
  );
  const cards = useMemo(() => characterRows ?? [], [characterRows]);
  const linkedCards = useMemo(() => cards.filter((row) => characterIds.includes(row.id)), [cards, characterIds]);
  // A linked card always shows as a character, even if its name was never typed in or the card was renamed.
  const castNames = useMemo(() => {
    const names = [...request.characters];
    for (const row of linkedCards) {
      const name = characterName(row);
      if (!names.some((entry) => sameName(entry, name))) names.push(name);
    }
    return names;
  }, [linkedCards, request.characters]);
  const castOptions = useMemo<FanficComboOption[]>(() => {
    const query = characterDraft.trim().toLowerCase();
    return cards
      .filter((row) => !characterIds.includes(row.id) && characterName(row).toLowerCase().includes(query))
      .slice(0, MAX_PICKS_SHOWN)
      .map((row) => ({ id: row.id, label: characterName(row), detail: "Adds canon notes from this card" }));
  }, [cards, characterDraft, characterIds]);
  const linkedCardFor = (name: string) => linkedCards.find((row) => sameName(characterName(row), name));
  /** A typed name that is exactly one card's name links that card, as if it had been picked. */
  const exactCard = (text: string) => {
    const matches = cards.filter((row) => sameName(characterName(row), text));
    return matches.length === 1 ? matches[0]! : null;
  };

  const lorebooks = useMemo(() => (lorebookRows ?? []) as Lorebook[], [lorebookRows]);
  const loreContext = useMemo(
    () => ({
      // Mirrors what the chapter scan loads, so the list shows every lorebook a chapter can draw on.
      chat: { id: chatId, mode: "fanfic", personaId, metadata: { activeLorebookIds: lorebookIds } },
      characters: characterIds.map((id) => ({ id })),
      persona: personaId ? { id: personaId } : null,
    }),
    [chatId, characterIds, lorebookIds, personaId],
  );
  const activeLore = useMemo(
    () =>
      lorebooks.flatMap((book) => {
        const reasons = resolveActiveLorebookScopeReasons(book, loreContext);
        if (reasons.length === 0) return [];
        return [
          {
            book,
            picked: reasons.some((reason) => reason.reason === "selected"),
            automatic: activeLorebookScopeReasonLabels(reasons.filter((reason) => reason.reason !== "selected")),
          },
        ];
      }),
    [loreContext, lorebooks],
  );
  const loreOptions = useMemo<FanficComboOption[]>(() => {
    const active = new Set(activeLore.map((entry) => entry.book.id));
    const query = lorebookSearch.trim().toLowerCase();
    return lorebooks
      .filter(
        (book) =>
          !active.has(book.id) &&
          (book.name ?? "").toLowerCase().includes(query) &&
          lorebookCanBeSelectedForContext(book, loreContext),
      )
      .slice(0, MAX_PICKS_SHOWN)
      .map((book) => ({
        id: book.id,
        label: book.name || "Untitled lorebook",
        detail: book.description?.trim() || undefined,
      }));
  }, [activeLore, loreContext, lorebookSearch, lorebooks]);

  const update = <K extends keyof FanficRequest>(key: K, value: FanficRequest[K]) =>
    setRequest((current) => ({ ...current, [key]: value }));
  // A name left typed in the box still counts, and links its card the way Enter would.
  const draftCard = exactCard(characterDraft);
  const normalized = normalizeFanficRequest({
    ...request,
    // Text left in a tag box still counts, so a typed-but-not-added ship is not lost.
    relationships: [...request.relationships, relationshipDraft],
    characters: [...castNames, draftCard ? characterName(draftCard) : characterDraft],
    tags: [...request.tags, tagDraft],
  });
  const problems = fanficRequestProblems(normalized);
  const oneShot = request.chapterCount <= 1;
  const sexualRating = fanficRatingAllowsSexualContent(request.rating);

  const addCharacter = (name: string, cardId: string | null) => {
    if (cardId && !characterIds.includes(cardId)) setCharacterIds([...characterIds, cardId]);
    if (!castNames.some((entry) => sameName(entry, name))) update("characters", [...castNames, name]);
  };
  const removeCharacter = (name: string) => {
    update(
      "characters",
      castNames.filter((entry) => !sameName(entry, name)),
    );
    const unlinked = new Set(linkedCards.filter((row) => sameName(characterName(row), name)).map((row) => row.id));
    if (unlinked.size > 0) setCharacterIds(characterIds.filter((id) => !unlinked.has(id)));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    // A saved connection that was deleted or is no longer a text model falls back to one that exists.
    const usableConnectionId = languageConnections.some((connection) => connection.id === connectionId)
      ? connectionId
      : (languageConnections[0]?.id ?? null);
    if (!usableConnectionId) {
      setConnectionError("Add a text model connection before requesting a fic.");
      return;
    }
    setConnectionError(null);
    onSubmit({
      request: normalized,
      connectionId: usableConnectionId,
      characterIds: draftCard && !characterIds.includes(draftCard.id) ? [...characterIds, draftCard.id] : characterIds,
      lorebookIds,
    });
  };

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-3" aria-label="Fanfic request">
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
        <FanficField
          label="Characters"
          htmlFor="fanfic-characters"
          hint={
            cards.length > 0
              ? "Pick a card from your library to send its notes as canon reference, or type any name and press Enter."
              : "Type a name and press Enter."
          }
        >
          {castNames.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 pb-1" aria-label="Characters in this fic">
              {castNames.map((name) => {
                const card = linkedCardFor(name);
                return (
                  <li
                    key={name.toLowerCase()}
                    className={cn(
                      "flex min-h-8 items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-[var(--foreground)]",
                      card
                        ? "border-[var(--primary)]/55 bg-[var(--primary)]/12"
                        : "border-[var(--border)] bg-[var(--secondary)]/45",
                    )}
                  >
                    {card && <BookUser size="0.75rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />}
                    <span className="max-w-[14rem] truncate">{name}</span>
                    {card && <span className="sr-only">(canon notes from your library)</span>}
                    <button
                      type="button"
                      onClick={() => removeCharacter(name)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                      aria-label={`Remove ${name}`}
                    >
                      <X size="0.75rem" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <FanficCombobox
            inputId="fanfic-characters"
            value={characterDraft}
            onValueChange={setCharacterDraft}
            options={castOptions}
            onPick={(option) => addCharacter(option.label, option.id)}
            onAddText={(text) => {
              const card = exactCard(text);
              addCharacter(card ? characterName(card) : text, card?.id ?? null);
            }}
            placeholder={cards.length > 0 ? "Type a name or search your characters" : "Add a character"}
            inputAriaLabel="Add a character"
            listLabel="Characters in your library"
            icon={<BookUser size="0.875rem" />}
          />
        </FanficField>
      </FanficSection>

      <FanficSection
        title="Lorebooks"
        hint="Entries go into the outline and chapters when their keywords come up in your request or the story."
      >
        {activeLore.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Lorebooks for this fic">
            {activeLore.map(({ book, picked, automatic }) => (
              <li
                key={book.id}
                className="flex min-h-10 items-center gap-2.5 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/8 py-1 pl-3 pr-1"
              >
                <BookOpen size="0.875rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                    {book.name || "Untitled lorebook"}
                  </span>
                  {!picked && automatic.length > 0 && (
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">
                      {automatic.map((label) => LORE_REASON_TEXT[label] ?? label).join(", ")}
                    </span>
                  )}
                </span>
                {picked && (
                  <button
                    type="button"
                    onClick={() => setLorebookIds(lorebookIds.filter((id) => id !== book.id))}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                    aria-label={`Remove lorebook ${book.name}`}
                  >
                    <X size="0.875rem" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {lorebooks.length > 0 ? (
          <FanficCombobox
            inputId="fanfic-lorebooks"
            value={lorebookSearch}
            onValueChange={setLorebookSearch}
            options={loreOptions}
            onPick={(option) => setLorebookIds([...lorebookIds, option.id])}
            placeholder="Search your lorebooks"
            inputAriaLabel="Add a lorebook"
            listLabel="Your lorebooks"
            emptyText={lorebookSearch.trim() ? "No lorebooks match." : "Every lorebook you can use is already on."}
            icon={<BookOpen size="0.875rem" />}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
            <span>You don't have any lorebooks yet.</span>
            <FanficButton onClick={() => useUIStore.getState().openRightPanel("lorebooks")}>
              <BookOpen size="0.875rem" aria-hidden="true" />
              Open Lorebooks
            </FanficButton>
          </div>
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
              {wordOptions(request.wordsPerChapter).map((words) => (
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
        <label className="flex items-start gap-2 text-sm text-[var(--foreground)]">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
            checked={request.research}
            onChange={(event) => update("research", event.target.checked)}
          />
          <span>
            Look things up online first
            <span className="block text-xs text-[var(--muted-foreground)]">
              Searches fan wikis and the web for the characters, setting, and any real-world topics, then plans from
              what it finds. Adds about a minute.
            </span>
          </span>
        </label>
        {languageConnections.length > 1 && (
          <FanficField label="Model connection" htmlFor="fanfic-connection">
            <select
              id="fanfic-connection"
              className={fanficInputClass}
              value={connectionId ?? ""}
              onChange={(event) => setConnectionId(event.target.value || null)}
            >
              {!languageConnections.some((connection) => connection.id === connectionId) && (
                <option value="">Choose a connection</option>
              )}
              {languageConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name || connection.id}
                </option>
              ))}
            </select>
          </FanficField>
        )}
      </FanficSection>

      {connectionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/35 bg-red-500/10 p-3 text-sm font-semibold text-[var(--foreground)]"
        >
          {connectionError}
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/35 bg-red-500/10 p-3 text-sm text-[var(--foreground)]"
        >
          <p className="font-semibold">Couldn't save the request</p>
          <p className="mt-0.5 break-words text-[var(--muted-foreground)]">{submitError}</p>
        </div>
      )}

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

      {/* The negative bottom matches the scroll pane's bottom padding, so the fade runs to the pane's edge. */}
      <div className="sticky -bottom-3 -mx-1 flex justify-end gap-2 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/95 to-transparent px-1 pb-4 pt-4 sm:-bottom-5 sm:pb-6">
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
