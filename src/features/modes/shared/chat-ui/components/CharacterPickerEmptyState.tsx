import { useState } from "react";
import { Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  blankCharacterCreateInput,
  starterStagingAssetUrl,
  useAddStarterCharacter,
  useCreateCharacter,
} from "../../../../catalog/characters/index";
import type { StarterCharacter } from "../../../../../engine/modes/roleplay/starter-characters";
import { toUserMessage } from "../../../../../shared/lib/error-message";

export function CharacterPickerEmptyState({
  status,
  noCharactersText,
  allAddedText,
  onOpenCharacters,
  onCharacterCreated,
  onImportCharacters,
  starters,
}: {
  status: {
    hasError: boolean;
    isPending: boolean;
    hasSearch: boolean;
    hasCharacters: boolean;
    hasUnselectedCharacters: boolean;
  };
  noCharactersText: string;
  allAddedText: string;
  onOpenCharacters: () => void;
  /** When set, an empty library offers a quick create form so setup is never left. */
  onCharacterCreated?: (characterId: string, name: string) => void;
  /** When set, an empty library offers importing a card without leaving setup. */
  onImportCharacters?: () => void;
  /** Ready-made characters an empty library can start with (needs `onCharacterCreated`). */
  starters?: readonly StarterCharacter[];
}) {
  const { hasError, isPending, hasSearch, hasCharacters, hasUnselectedCharacters } = status;
  const message = hasError
    ? "Characters could not be loaded."
    : isPending
      ? "Loading characters..."
      : !hasCharacters
        ? noCharactersText
        : !hasUnselectedCharacters
          ? allAddedText
          : "No matches.";
  const libraryEmpty = !hasError && !isPending && !hasSearch && !hasCharacters;

  return (
    <div className="flex flex-col items-center gap-2 px-3 py-3 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
      <p>{message}</p>
      {libraryEmpty && onCharacterCreated && starters && starters.length > 0 && (
        <StarterCharacterChoices starters={starters} onCreated={onCharacterCreated} />
      )}
      {libraryEmpty && onCharacterCreated && <QuickCreateCharacter onCreated={onCharacterCreated} />}
      {libraryEmpty && onImportCharacters && (
        <button
          type="button"
          onClick={onImportCharacters}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
        >
          <Upload size="0.75rem" aria-hidden="true" />
          Import a character card
        </button>
      )}
      {libraryEmpty && (
        <button
          type="button"
          onClick={onOpenCharacters}
          className={
            onCharacterCreated
              ? "font-medium text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
              : "rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1.5 font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20"
          }
        >
          Open Characters
        </button>
      )}
    </div>
  );
}

function StarterCharacterChoices({
  starters,
  onCreated,
}: {
  starters: readonly StarterCharacter[];
  onCreated: (characterId: string, name: string) => void;
}) {
  const { add } = useAddStarterCharacter();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const choose = async (starter: StarterCharacter) => {
    if (creatingId) return;
    setCreatingId(starter.id);
    try {
      const { id, artError } = await add(starter);
      if (artError) {
        toast.error(`${starter.name} was added, but their pictures couldn't be saved.`, {
          description: toUserMessage(artError, {
            fallback: "You can add sprites and an avatar later in Characters.",
          }),
        });
      }
      onCreated(id, starter.name);
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: `Couldn't add ${starter.name}. Try again.` }));
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5 text-left">
      <p className="text-[0.6875rem] font-medium text-[var(--foreground)]">Start with one of these</p>
      {starters.map((starter) => (
        <button
          key={starter.id}
          type="button"
          disabled={creatingId !== null}
          onClick={() => void choose(starter)}
          className="flex items-start gap-2 rounded-lg bg-[var(--secondary)] px-2.5 py-2 text-left ring-1 ring-[var(--border)] transition-colors hover:ring-[var(--primary)] disabled:opacity-60"
        >
          {creatingId === starter.id ? (
            <Loader2
              size="0.875rem"
              className="mt-0.5 shrink-0 animate-spin text-[var(--primary)]"
              aria-hidden="true"
            />
          ) : starter.staging ? (
            <img
              src={starterStagingAssetUrl(starter.staging, starter.staging.avatar)}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
            />
          ) : (
            <Plus size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          )}
          <span className="min-w-0">
            <span className="block text-xs font-medium text-[var(--foreground)]">{starter.name}</span>
            <span className="block text-[0.6875rem] text-[var(--muted-foreground)]">{starter.hook}</span>
          </span>
        </button>
      ))}
      <p className="pt-1 text-[0.6875rem] font-medium text-[var(--foreground)]">Or make your own</p>
    </div>
  );
}

function QuickCreateCharacter({ onCreated }: { onCreated: (characterId: string, name: string) => void }) {
  const createCharacter = useCreateCharacter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const trimmedName = name.trim();

  const submit = async () => {
    if (!trimmedName || createCharacter.isPending) return;
    try {
      const result = await createCharacter.mutateAsync(blankCharacterCreateInput(trimmedName, description.trim()));
      const id = (result as { id?: string } | undefined)?.id;
      if (!id) throw new Error("The new character came back without an id.");
      setName("");
      setDescription("");
      onCreated(id, trimmedName);
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: "Couldn't create the character. Try again." }));
    }
  };

  return (
    <form
      className="flex w-full flex-col gap-1.5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="text-[0.6875rem] font-medium text-[var(--foreground)]">
        Character name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Mira"
          className="mt-1 w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]"
        />
      </label>
      <label className="text-[0.6875rem] font-medium text-[var(--foreground)]">
        Who are they? <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          placeholder="e.g. A cheerful tavern keeper who knows all the town gossip."
          className="mt-1 w-full resize-none rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]"
        />
      </label>
      <button
        type="submit"
        disabled={!trimmedName || createCharacter.isPending}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {createCharacter.isPending ? (
          <Loader2 size="0.75rem" className="animate-spin" aria-hidden="true" />
        ) : (
          <Plus size="0.75rem" aria-hidden="true" />
        )}
        Create and add
      </button>
      <p className="text-[0.625rem] text-[var(--muted-foreground)]">You can add more detail later in Characters.</p>
    </form>
  );
}
