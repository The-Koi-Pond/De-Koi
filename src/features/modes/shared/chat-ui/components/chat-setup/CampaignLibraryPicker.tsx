import { useId, useMemo, useState } from "react";
import { BookOpen, Plus, Search, Sparkles, X } from "lucide-react";
import type { Lorebook } from "../../../../../../engine/contracts/types/lorebook";
import { useCharacterSummaries } from "../../../../../catalog/characters/index";
import { useLorebooks } from "../../../../../catalog/lorebooks/index";
import { cn } from "../../../../../../shared/lib/utils";
import { SetupCharacterChips, SetupCharacterList } from "./SetupCharacterList";
import { namedSetupCharacter, toSetupCharacter, type SetupCharacter } from "./setup-characters";
import { SETUP_INPUT_CLASS, SETUP_ROW_CLASS, SETUP_SECTION_HEADING_CLASS } from "./setup-styles";

const MAX_PICKS = 6;

function lorebookName(lorebook: Lorebook): string {
  return lorebook.name?.trim() || "Untitled lorebook";
}

/** The name a person would type for a character: "Harlequin (Pro Dom)" is mentioned as "Harlequin". */
function spokenName(name: string): string {
  return name.replace(/\s*[([{].*?[)\]}]\s*/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Library characters the ask names (whole words, any case) that aren't picked yet. */
function mentionedCharacters(
  ask: string,
  library: readonly SetupCharacter[],
  pickedIds: ReadonlySet<string>,
): SetupCharacter[] {
  if (!ask.trim()) return [];
  return library.filter((character) => {
    if (pickedIds.has(character.id)) return false;
    const name = spokenName(character.name);
    if (name.length < 3) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, "iu").test(ask);
  });
}

/**
 * The player's own characters and lorebooks for a campaign. Picks stay on the card until the build; nothing is added
 * to the setup's draft chat. Characters the ask names are offered with one click.
 */
export function CampaignLibraryPicker({
  ask,
  characters,
  lorebookIds,
  disabled,
  onCharactersChange,
  onLorebooksChange,
  onImport,
  onOpenCharacters,
}: {
  ask: string;
  characters: readonly SetupCharacter[];
  lorebookIds: readonly string[];
  disabled: boolean;
  onCharactersChange: (characters: SetupCharacter[]) => void;
  onLorebooksChange: (lorebookIds: string[]) => void;
  onImport: () => void;
  onOpenCharacters: () => void;
}) {
  const charactersHeadingId = useId();
  const lorebooksHeadingId = useId();
  const lorebookSearchId = useId();
  const [lorebookSearch, setLorebookSearch] = useState("");
  const [browsingCharacters, setBrowsingCharacters] = useState(false);
  const libraryQuery = useCharacterSummaries(true);
  const lorebooksQuery = useLorebooks();

  const pickedIds = useMemo(() => new Set(characters.map((character) => character.id)), [characters]);
  const library = useMemo(
    () => ((libraryQuery.data ?? []) as Parameters<typeof toSetupCharacter>[0][]).map(toSetupCharacter),
    [libraryQuery.data],
  );
  const suggestions = useMemo(() => mentionedCharacters(ask, library, pickedIds), [ask, library, pickedIds]);
  const full = characters.length >= MAX_PICKS;

  const lorebooks = useMemo(() => (lorebooksQuery.data ?? []) as Lorebook[], [lorebooksQuery.data]);
  const pickedLorebooks = useMemo(() => {
    const byId = new Map(lorebooks.map((lorebook) => [lorebook.id, lorebook]));
    return lorebookIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [lorebookIds, lorebooks]);
  const query = lorebookSearch.trim().toLowerCase();
  const lorebookChoices = lorebooks
    .filter((lorebook) => !lorebookIds.includes(lorebook.id))
    .filter((lorebook) => !query || lorebookName(lorebook).toLowerCase().includes(query));

  const addCharacter = (character: SetupCharacter) => {
    if (pickedIds.has(character.id) || full) return;
    onCharactersChange([...characters, character]);
  };

  return (
    <>
      <section aria-labelledby={charactersHeadingId} className="flex flex-col gap-2">
        <h3 id={charactersHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
          Your characters (optional)
        </h3>
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Pick characters from your library to star in it. They play themselves, exactly as their cards are written.
          Leave empty and De-Koi casts it for you.
        </p>
        {suggestions.length > 0 && !full && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles size="0.8rem" aria-hidden="true" className="text-[var(--primary)]" />
            <span className="text-[0.6875rem] text-[var(--muted-foreground)]">You mentioned:</span>
            {suggestions.slice(0, 4).map((character) => (
              <button
                key={character.id}
                type="button"
                disabled={disabled}
                onClick={() => addCharacter(character)}
                className="flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--primary)]/40 hover:bg-[var(--primary)]/20 disabled:opacity-50"
              >
                <Plus size="0.7rem" aria-hidden="true" />
                Use {character.name}
              </button>
            ))}
          </div>
        )}
        <SetupCharacterChips
          characters={characters}
          onRemove={(id) => onCharactersChange(characters.filter((character) => character.id !== id))}
        />
        {browsingCharacters && !full ? (
          <SetupCharacterList
            enabled
            selectedIds={[...pickedIds]}
            noCharactersText="No characters yet. Leave this empty and De-Koi casts the campaign for you."
            allAddedText="All your characters are picked."
            onAdd={addCharacter}
            onCreated={(id, name) => addCharacter(namedSetupCharacter(id, name))}
            onImport={onImport}
            onOpenCharacters={onOpenCharacters}
          />
        ) : (
          !full && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setBrowsingCharacters(true)}
              className="flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <Plus size="0.8rem" aria-hidden="true" />
              Pick from your characters
            </button>
          )
        )}
      </section>

      <section aria-labelledby={lorebooksHeadingId} className="flex flex-col gap-2">
        <h3 id={lorebooksHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
          Your world (optional)
        </h3>
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Pick lorebooks to set it in their world. The plan follows them, and they stay attached while you play.
        </p>
        {pickedLorebooks.length > 0 && (
          <ul aria-label="Picked lorebooks" className="flex flex-wrap gap-1.5">
            {pickedLorebooks.map((lorebook) => (
              <li
                key={lorebook.id}
                className="flex max-w-full items-center gap-1.5 rounded-full bg-[var(--secondary)] py-0.5 pl-2 pr-1 ring-1 ring-[var(--border)]"
              >
                <BookOpen size="0.75rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
                <span className="min-w-0 truncate text-xs font-medium text-[var(--foreground)]">
                  {lorebookName(lorebook)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${lorebookName(lorebook)}`}
                  disabled={disabled}
                  onClick={() => onLorebooksChange(lorebookIds.filter((id) => id !== lorebook.id))}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  <X size="0.7rem" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {lorebooks.length === 0 ? (
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No lorebooks yet.</p>
        ) : (
          lorebookIds.length < MAX_PICKS && (
            <>
              <div className="relative">
                <label htmlFor={lorebookSearchId} className="sr-only">
                  Search lorebooks
                </label>
                <Search
                  size="0.8rem"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                />
                <input
                  id={lorebookSearchId}
                  type="search"
                  value={lorebookSearch}
                  disabled={disabled}
                  onChange={(event) => setLorebookSearch(event.target.value)}
                  placeholder="Search lorebooks…"
                  className={cn(SETUP_INPUT_CLASS, "pl-8")}
                />
              </div>
              {query && (
                <ul aria-label="Lorebooks you can pick" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                  {lorebookChoices.length === 0 ? (
                    <li className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">No matches.</li>
                  ) : (
                    lorebookChoices.slice(0, 20).map((lorebook) => (
                      <li key={lorebook.id}>
                        <button
                          type="button"
                          aria-label={`Use ${lorebookName(lorebook)}`}
                          onClick={() => {
                            onLorebooksChange([...lorebookIds, lorebook.id]);
                            setLorebookSearch("");
                          }}
                          className={SETUP_ROW_CLASS}
                        >
                          <BookOpen
                            size="0.9rem"
                            aria-hidden="true"
                            className="shrink-0 text-[var(--muted-foreground)]"
                          />
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">
                            {lorebookName(lorebook)}
                          </span>
                          <Plus size="0.9rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </>
          )
        )}
      </section>
    </>
  );
}
