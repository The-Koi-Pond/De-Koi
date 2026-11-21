import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { AlertTriangle, Plus, Search, X } from "lucide-react";
import type { StarterCharacter } from "../../../../../../engine/modes/roleplay/starter-characters";
import { CharacterAvatarImage, useCharacterSummaries } from "../../../../../catalog/characters/index";
import { cn } from "../../../../../../shared/lib/utils";
import { splitSearchTerms } from "../../lib/chat-settings-character-search";
import { CharacterPickerEmptyState } from "../CharacterPickerEmptyState";
import { characterMatchesSearch, toSetupCharacter, type SetupCharacter } from "./setup-characters";
import { SETUP_INPUT_CLASS, SETUP_ROW_CLASS } from "./setup-styles";

const SEARCH_DEBOUNCE_MS = 180;

function useDebouncedText(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}

/**
 * The searchable list of characters that can still be added, shared by the Conversation card, the Roleplay
 * characters step and Quick setup. Picked characters leave the list; the empty states and their create, import and
 * starter actions come from `CharacterPickerEmptyState`.
 */
export function SetupCharacterList({
  enabled,
  selectedIds,
  noCharactersText,
  allAddedText,
  starters,
  searchInputRef,
  onAdd,
  onCreated,
  onImport,
  onOpenCharacters,
}: {
  /** Characters load only where setup shows this list. */
  enabled: boolean;
  selectedIds: readonly string[];
  noCharactersText: string;
  allAddedText: string;
  starters?: readonly StarterCharacter[];
  searchInputRef?: RefObject<HTMLInputElement | null>;
  onAdd: (character: SetupCharacter) => void;
  onCreated: (characterId: string, name: string) => void;
  onImport: () => void;
  onOpenCharacters: () => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedText(search);
  const searching = search.trim().length > 0;
  const results = useCharacterSummaries(enabled, debouncedSearch);
  // Only while searching: whether the whole library has characters, to tell "no matches" from "none yet".
  const library = useCharacterSummaries(enabled && searching);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const terms = useMemo(() => splitSearchTerms(search), [search]);
  const available = useMemo(
    () =>
      (results.data ?? [])
        .filter((summary) => !selectedSet.has(summary.id))
        .map(toSetupCharacter)
        .filter((character) => characterMatchesSearch(character, terms)),
    [results.data, selectedSet, terms],
  );

  const libraryRows = (searching ? library.data : results.data) ?? [];
  // A starter already in the library (added earlier, maybe renamed back) isn't offered again.
  const remainingStarters = useMemo(() => {
    if (!starters) return undefined;
    const names = new Set(libraryRows.map((row) => toSetupCharacter(row).name.trim().toLowerCase()));
    return starters.filter((starter) => !names.has(starter.name.trim().toLowerCase()));
  }, [starters, libraryRows]);
  const status = {
    hasError: results.isError || (searching && library.isError),
    isPending: results.isFetching || search !== debouncedSearch,
    hasSearch: searching,
    hasCharacters: libraryRows.length > 0 || selectedIds.length > 0,
    hasUnselectedCharacters: libraryRows.some((summary) => !selectedSet.has(summary.id)),
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search characters
        </label>
        <Search
          size="0.8rem"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
        />
        <input
          ref={searchInputRef}
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search characters…"
          className={cn(SETUP_INPUT_CLASS, "pl-8")}
        />
      </div>
      {available.length > 0 ? (
        <ul aria-label="Characters you can add" className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {available.map((character) => (
            <li key={character.id}>
              <button
                type="button"
                aria-label={`Add ${character.name}`}
                onClick={() => onAdd(character)}
                className={SETUP_ROW_CLASS}
              >
                <SetupCharacterAvatar character={character} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--foreground)]">{character.name}</span>
                  {character.title && (
                    <span className="block truncate text-[0.6875rem] italic text-[var(--muted-foreground)]">
                      {character.title}
                    </span>
                  )}
                </span>
                <SetupTokenBadge character={character} />
                <Plus size="0.9rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <CharacterPickerEmptyState
          status={status}
          noCharactersText={noCharactersText}
          allAddedText={allAddedText}
          starters={remainingStarters}
          onCharacterCreated={onCreated}
          onImportCharacters={onImport}
          onOpenCharacters={onOpenCharacters}
        />
      )}
    </div>
  );
}

/** The picked characters as removable chips (Conversation and Quick setup). */
export function SetupCharacterChips({
  characters,
  onRemove,
}: {
  characters: readonly SetupCharacter[];
  onRemove: (characterId: string) => void;
}) {
  if (characters.length === 0) return null;
  return (
    <ul aria-label="Picked characters" className="flex flex-wrap gap-1.5">
      {characters.map((character) => (
        <li
          key={character.id}
          title={character.title ? `${character.name} - ${character.title}` : character.name}
          className="flex max-w-full items-center gap-1.5 rounded-full bg-[var(--secondary)] py-0.5 pl-0.5 pr-1 ring-1 ring-[var(--border)]"
        >
          <SetupCharacterAvatar character={character} size="small" />
          <span className="min-w-0 truncate text-xs font-medium text-[var(--foreground)]">{character.name}</span>
          <SetupTokenBadge character={character} />
          <button
            type="button"
            aria-label={`Remove ${character.name}`}
            onClick={() => onRemove(character.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="0.7rem" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The picked characters as rows with a Remove button (the Roleplay characters step). */
export function SetupCharacterRows({
  characters,
  onRemove,
}: {
  characters: readonly SetupCharacter[];
  onRemove: (characterId: string) => void;
}) {
  if (characters.length === 0) return null;
  return (
    <ul aria-label="Added characters" className="flex flex-col gap-1">
      {characters.map((character) => (
        <li
          key={character.id}
          className="flex items-center gap-2.5 rounded-lg bg-[var(--secondary)] px-2.5 py-2 ring-1 ring-[var(--border)]"
        >
          <SetupCharacterAvatar character={character} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-[var(--foreground)]">{character.name}</span>
            {character.title && (
              <span className="block truncate text-[0.6875rem] italic text-[var(--muted-foreground)]">
                {character.title}
              </span>
            )}
          </span>
          <SetupTokenBadge character={character} />
          <button
            type="button"
            aria-label={`Remove ${character.name}`}
            onClick={() => onRemove(character.id)}
            className="shrink-0 rounded-lg px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

function SetupCharacterAvatar({
  character,
  size = "regular",
}: {
  character: SetupCharacter;
  size?: "regular" | "small";
}) {
  const hasAvatar = Boolean(character.avatarUrl || character.avatarFilePath || character.avatarFilename);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] font-semibold text-[var(--muted-foreground)]",
        size === "small" ? "h-6 w-6 text-[0.625rem]" : "h-8 w-8 text-xs",
      )}
    >
      {hasAvatar ? (
        <CharacterAvatarImage
          src={character.avatarUrl}
          avatarFilePath={character.avatarFilePath}
          avatarFilename={character.avatarFilename}
          crop={character.avatarCrop}
          alt=""
          className="h-full w-full object-cover"
          thumbnailSize={64}
        />
      ) : (
        character.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

function SetupTokenBadge({ character }: { character: SetupCharacter }) {
  const warning = character.tokenWarning;
  if (!warning) return null;
  return (
    <span
      title={warning.description}
      className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle size="0.6rem" aria-hidden="true" />
      {warning.label}
    </span>
  );
}
