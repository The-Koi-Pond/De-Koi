export function CharacterPickerEmptyState({
  hasError,
  isPending,
  hasSearch,
  hasCharacters,
  hasUnselectedCharacters,
  noCharactersText,
  allAddedText,
  onOpenCharacters,
}: {
  hasError: boolean;
  isPending: boolean;
  hasSearch: boolean;
  hasCharacters: boolean;
  hasUnselectedCharacters: boolean;
  noCharactersText: string;
  allAddedText: string;
  onOpenCharacters: () => void;
}) {
  const message = hasError
    ? "Characters could not be loaded."
    : isPending
      ? "Loading characters..."
      : !hasCharacters
        ? noCharactersText
        : !hasUnselectedCharacters
          ? allAddedText
          : "No matches.";
  const canOpenCharacters = !hasError && !isPending && !hasSearch && !hasCharacters;

  return (
    <div className="flex flex-col items-center gap-2 px-3 py-3 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
      <p>{message}</p>
      {canOpenCharacters && (
        <button
          type="button"
          onClick={onOpenCharacters}
          className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1.5 font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20"
        >
          Open Characters
        </button>
      )}
    </div>
  );
}
