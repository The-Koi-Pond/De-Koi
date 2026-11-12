import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import {
  collectCharacterTags,
  getCharacterTags,
  type FavoriteFilter,
  type ParsedCharacterRow,
} from "../lib/characters-panel-model";
import { useUpdateCharacter } from "./use-characters";

/**
 * `wholeLibrary` says `parsedCharacters` is the loaded, unsearched library, so a tag missing from it is really gone.
 */
export function useCharactersPanelFilters(parsedCharacters: ParsedCharacterRow[], wholeLibrary: boolean) {
  const updateCharacter = useUpdateCharacter();
  const [includedTags, setIncludedTags] = useState<Set<string>>(new Set());
  const [excludedTags, setExcludedTags] = useState<Set<string>>(new Set());
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [favFilter, setFavFilter] = useState<FavoriteFilter>("all");

  const allTags = useMemo(() => collectCharacterTags(parsedCharacters), [parsedCharacters]);

  // A filter on a tag no character has any more would quietly hide the whole list. While the list loads or a
  // search narrows it, a missing tag isn't gone, so only prune against the whole library.
  useEffect(() => {
    if (!wholeLibrary) return;
    const existing = new Set(allTags);
    const keepExisting = (prev: Set<string>) =>
      [...prev].every((tag) => existing.has(tag)) ? prev : new Set([...prev].filter((tag) => existing.has(tag)));
    setIncludedTags(keepExisting);
    setExcludedTags(keepExisting);
  }, [allTags, wholeLibrary]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title: "Remove Tag",
          message: `Remove tag "${tag}" from all characters?`,
          confirmLabel: "Remove",
          tone: "destructive",
        }))
      ) {
        return;
      }
      const affected = parsedCharacters.filter((character) => getCharacterTags(character).includes(tag));
      const clearTagSelections = () => {
        setIncludedTags((prev) => {
          if (!prev.has(tag)) return prev;
          const next = new Set(prev);
          next.delete(tag);
          return next;
        });
        setExcludedTags((prev) => {
          if (!prev.has(tag)) return prev;
          const next = new Set(prev);
          next.delete(tag);
          return next;
        });
      };
      if (affected.length === 0) {
        clearTagSelections();
        return;
      }

      const results = await Promise.allSettled(
        affected.map((character) => {
          const newTags = getCharacterTags(character).filter((candidate) => candidate !== tag);
          return updateCharacter.mutateAsync({ id: character.id, data: { tags: newTags } });
        }),
      );
      const failed = results.filter((result) => result.status === "rejected");
      const successCount = affected.length - failed.length;
      if (failed.length === 0) {
        clearTagSelections();
        toast.success(`Removed tag from ${successCount} character${successCount === 1 ? "" : "s"}.`);
        return;
      }
      if (successCount > 0) {
        toast.warning(`Removed tag from ${successCount} of ${affected.length} characters. Try again for the rest.`);
      } else {
        toast.error("Couldn't remove the tag. Try again.");
      }
    },
    [parsedCharacters, updateCharacter],
  );

  const toggleIncludedTag = useCallback((tag: string) => {
    setIncludedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
    setExcludedTags((prev) => {
      if (!prev.has(tag)) return prev;
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
  }, []);

  const toggleExcludedTag = useCallback((tag: string) => {
    setIncludedTags((prev) => {
      if (!prev.has(tag)) return prev;
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
    setExcludedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const clearTagFilters = useCallback(() => {
    setIncludedTags(new Set());
    setExcludedTags(new Set());
  }, []);

  // A clicked tag cycles off → include → exclude → off (the same order as `cycleTagFilter`).
  const cycleTag = useCallback(
    (tag: string) => {
      if (includedTags.has(tag) || excludedTags.has(tag)) toggleExcludedTag(tag);
      else toggleIncludedTag(tag);
    },
    [excludedTags, includedTags, toggleExcludedTag, toggleIncludedTag],
  );

  return {
    allTags,
    clearTagFilters,
    cycleTag,
    excludedTags,
    favFilter,
    handleDeleteTag,
    includedTags,
    setFavFilter,
    setTagsExpanded,
    tagsExpanded,
    toggleExcludedTag,
    toggleIncludedTag,
  };
}
