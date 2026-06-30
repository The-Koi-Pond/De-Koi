import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { useCharacter, useCharacterSummaries, type CharacterSummary } from "../hooks/use-characters";
import {
  characterHasAnyExcludedTag,
  characterMatchesScopedSearchTerms,
  parseCharacterSearchQuery,
} from "../lib/character-search";
import {
  getText,
  gridColumnCount,
  isSortOption,
  parseCharacterRow,
  readSessionSort,
  writeSessionSort,
  type CharacterRow,
  type ParsedCharacterRow,
  type SortOption,
} from "../lib/character-library-model";
import {
  characterLibrarySelectionLabel,
  selectVisibleCharacterIds,
  toggleCharacterLibrarySelection,
} from "../lib/character-library-selection";
import { exportApi } from "../../../../shared/api/export-api";
import { ExportFormatDialog, type ExportFormatChoice } from "../../../../shared/components/ui/ExportFormatDialog";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { CharacterLibraryCard } from "./CharacterLibraryCard";
import { CharacterLibraryDetailCard } from "./CharacterLibraryDetailCard";
import { CharacterLibraryEmptyState } from "./CharacterLibraryEmptyState";
import { CharacterLibraryToolbar } from "./CharacterLibraryToolbar";
import { CharactersSelectionToolbar } from "./CharactersSelectionToolbar";

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === "") {
      setDebounced("");
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);
  return debounced;
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    const setMeasuredWidth = (nextWidth: number) => {
      const roundedWidth = Math.round(nextWidth);
      setWidth((current) => (current === roundedWidth ? current : roundedWidth));
    };
    const scheduleWidth = (nextWidth: number) => {
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setMeasuredWidth(nextWidth);
      });
    };

    scheduleWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const borderBox = entry?.borderBoxSize?.[0];
      scheduleWidth(borderBox?.inlineSize ?? entry?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [ref]);
  return width;
}

function characterSummaryToRow(character: CharacterSummary): CharacterRow {
  const data = character.data ?? {};
  return {
    id: character.id,
    data: {
      name: getText(data.name) || undefined,
      description: getText(data.description) || undefined,
      personality: getText(data.personality) || undefined,
      scenario: getText(data.scenario) || undefined,
      first_mes: getText(data.first_mes) || undefined,
      mes_example: getText(data.mes_example) || undefined,
      creator: getText(data.creator) || undefined,
      creator_notes: getText(data.creator_notes) || undefined,
      character_version: getText(data.character_version) || undefined,
      system_prompt: getText(data.system_prompt) || undefined,
      post_history_instructions: getText(data.post_history_instructions) || undefined,
      tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
      alternate_greetings: Array.isArray(data.alternate_greetings)
        ? data.alternate_greetings.filter((greeting): greeting is string => typeof greeting === "string")
        : undefined,
      character_book: data.character_book,
      extensions:
        data.extensions && typeof data.extensions === "object" && !Array.isArray(data.extensions)
          ? data.extensions
          : undefined,
    },
    comment: character.comment,
    avatarPath: character.avatarPath,
    avatarFilePath: character.avatarFilePath,
    avatarFilename: character.avatarFilename,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  };
}

export function CharacterLibraryView() {
  const closeCharacterLibrary = useUIStore((s) => s.closeCharacterLibrary);
  const openCharacterDetail = useUIStore((s) => s.openCharacterDetail);
  const openModal = useUIStore((s) => s.openModal);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>(readSessionSort);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportingSelected, setExportingSelected] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 180);
  const searchQuery = useMemo(() => parseCharacterSearchQuery(debouncedSearch), [debouncedSearch]);
  const { data: characters, isLoading, isFetching, isError, refetch } = useCharacterSummaries(true, searchQuery.text);
  const selectedCharacterQuery = useCharacter(selectedCharacterId);
  const { data: selectedCharacterDetail } = selectedCharacterQuery;
  const listScrollRef = useRef<HTMLElement | null>(null);
  const listWidth = useElementWidth(listScrollRef);

  const parsedCharacters = useMemo(() => {
    if (!characters) return [];
    return characters.map((character) => parseCharacterRow(characterSummaryToRow(character)));
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    return parsedCharacters.filter((char) => {
      const isFavorite = !!char.parsed.extensions?.fav;
      if (favoritesOnly && !isFavorite) return false;
      if (characterHasAnyExcludedTag(char.parsed, searchQuery.excludedTags)) return false;
      if (
        !characterMatchesScopedSearchTerms({
          data: char.parsed,
          comment: char.comment,
          scopedTerms: searchQuery.scopedTerms,
        })
      ) {
        return false;
      }
      return true;
    });
  }, [favoritesOnly, parsedCharacters, searchQuery.excludedTags, searchQuery.scopedTerms]);

  const sortedCharacters = useMemo(() => {
    const list = [...filteredCharacters];

    switch (sort) {
      case "name-asc":
        return list.sort((left, right) => getText(left.parsed.name).localeCompare(getText(right.parsed.name)));
      case "name-desc":
        return list.sort((left, right) => getText(right.parsed.name).localeCompare(getText(left.parsed.name)));
      case "newest":
        return list.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
      case "oldest":
        return list.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
      case "favorites":
        return list.sort((left, right) => {
          const leftFavorite = left.parsed.extensions?.fav ? 1 : 0;
          const rightFavorite = right.parsed.extensions?.fav ? 1 : 0;
          if (rightFavorite !== leftFavorite) return rightFavorite - leftFavorite;
          return getText(left.parsed.name).localeCompare(getText(right.parsed.name));
        });
      default:
        return list;
    }
  }, [filteredCharacters, sort]);

  useEffect(() => {
    setSelectedCharacterId((current) => {
      if (current && sortedCharacters.some((char) => char.id === current)) {
        return current;
      }

      return sortedCharacters[0]?.id ?? null;
    });
  }, [sortedCharacters]);

  const selectedCharacter = useMemo(
    () =>
      selectedCharacterDetail
        ? parseCharacterRow(selectedCharacterDetail as CharacterRow)
        : (sortedCharacters.find((char) => char.id === selectedCharacterId) ?? null),
    [selectedCharacterDetail, selectedCharacterId, sortedCharacters],
  );
  const columnCount = gridColumnCount(listWidth);
  const virtualRows = useMemo(() => {
    const rows: ParsedCharacterRow[][] = [];
    for (let index = 0; index < sortedCharacters.length; index += columnCount) {
      rows.push(sortedCharacters.slice(index, index + columnCount));
    }
    return rows;
  }, [columnCount, sortedCharacters]);
  const rowVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => (columnCount === 1 ? 150 : 360),
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
  });
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => rowVirtualizer.measure());
    return () => window.cancelAnimationFrame(frame);
  }, [rowVirtualizer, selectedCharacterDetail, selectedCharacterId]);

  const selectedCount = selectedCharacterIds.size;
  const selectedCountLabel = characterLibrarySelectionLabel(selectedCount);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((current) => {
      if (current) {
        setSelectedCharacterIds(new Set());
        return false;
      }
      return true;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedCharacterIds(new Set());
  }, []);

  const toggleSelectedCharacter = useCallback((characterId: string) => {
    setSelectedCharacterIds((current) => toggleCharacterLibrarySelection(current, characterId));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCharacterIds(new Set());
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedCharacterIds(selectVisibleCharacterIds(sortedCharacters));
  }, [sortedCharacters]);

  const handleExportSelected = useCallback(
    async (format: ExportFormatChoice) => {
      if (selectedCharacterIds.size === 0) return;
      setExportingSelected(true);
      setExportDialogOpen(false);
      try {
        exportApi.triggerDownload(await exportApi.charactersBulk([...selectedCharacterIds], format));
        toast.success(`Exported ${selectedCharacterIds.size} character${selectedCharacterIds.size === 1 ? "" : "s"}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to export characters");
      } finally {
        setExportingSelected(false);
      }
    },
    [selectedCharacterIds],
  );

  const handleSortChange = (value: string) => {
    if (!isSortOption(value)) return;
    setSort(value);
    writeSessionSort(value);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(244,114,182,0.14),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.14),_transparent_26%),var(--background)]">
      <CharacterLibraryToolbar
        filteredCount={filteredCharacters.length}
        totalCount={parsedCharacters.length}
        updating={isFetching && !isLoading}
        search={search}
        onSearchChange={setSearch}
        favoritesOnly={favoritesOnly}
        onToggleFavorites={() => setFavoritesOnly((current) => !current)}
        sort={sort}
        onSortChange={handleSortChange}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        onToggleSelectionMode={toggleSelectionMode}
        onClose={closeCharacterLibrary}
        onCreate={() => openModal("create-character")}
        onImport={() => openModal("import-character")}
        onOpenMaker={() => openModal("character-maker")}
      />

      {selectionMode && (
        <div className="border-b border-[var(--border)]/30 bg-[var(--card)]/72 px-3 py-2 backdrop-blur-xl md:px-6">
          <CharactersSelectionToolbar
            selectedCount={selectedCount}
            visibleCount={sortedCharacters.length}
            exportingSelected={exportingSelected}
            onSelectVisible={selectAllVisible}
            onClearSelection={clearSelection}
            onExportSelected={() => setExportDialogOpen(true)}
            onDone={exitSelectionMode}
          />
          <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">{selectedCountLabel}</p>
        </div>
      )}

      <ExportFormatDialog
        open={exportDialogOpen}
        title="Export Characters"
        description="Native keeps De-Koi metadata and image payloads for re-import. Compatible exports direct Chara Card V2 JSON files for other platforms."
        compatibleDescription="Exports direct Chara Card V2 JSON files without the native wrapper."
        onClose={() => setExportDialogOpen(false)}
        onSelect={handleExportSelected}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-0 xl:grid-cols-[minmax(0,1.1fr)_28rem]">
        <section ref={listScrollRef} className="min-h-0 overflow-y-auto px-4 py-4 md:px-6">
          {isLoading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div key={item} className="shimmer aspect-[4/5] rounded-[1.75rem]" />
              ))}
            </div>
          )}

          {!isLoading && isError && (
            <CharacterLibraryEmptyState
              title="Characters could not be loaded"
              tone="error"
              action={{ label: "Retry", onClick: () => void refetch() }}
            />
          )}

          {!isLoading && !isError && sortedCharacters.length === 0 && (
            <CharacterLibraryEmptyState
              title="No matching characters"
              description="Try a different search, turn off favorites-only, or import a new card into the library."
            />
          )}

          {!isLoading && !isError && sortedCharacters.length > 0 && (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
                    {(virtualRows[virtualRow.index] ?? []).map((char) => {
                      const isActive = selectedCharacterId === char.id;

                      return (
                        <Fragment key={char.id}>
                          <CharacterLibraryCard
                            character={char}
                            active={isActive}
                            selectionMode={selectionMode}
                            bulkSelected={selectedCharacterIds.has(char.id)}
                            onSelect={selectionMode ? toggleSelectedCharacter : setSelectedCharacterId}
                          />

                          {isActive && (
                            <div className="col-span-full lg:hidden">
                              <CharacterLibraryDetailCard
                                character={selectedCharacter?.id === char.id ? selectedCharacter : char}
                                onEdit={openCharacterDetail}
                                fullRecordLoading={
                                  selectedCharacterId === char.id &&
                                  selectedCharacterQuery.isFetching &&
                                  !selectedCharacterDetail
                                }
                                fullRecordError={selectedCharacterId === char.id && selectedCharacterQuery.isError}
                                onRetryFullRecord={() => void selectedCharacterQuery.refetch()}
                              />
                            </div>
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="hidden min-h-0 overflow-visible border-t border-[var(--border)]/40 bg-[var(--card)]/65 backdrop-blur-xl lg:block lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="space-y-4 p-4 md:p-6">
            {selectedCharacter ? (
              <CharacterLibraryDetailCard
                character={selectedCharacter}
                onEdit={openCharacterDetail}
                fullRecordLoading={selectedCharacterQuery.isFetching && !selectedCharacterDetail}
                fullRecordError={selectedCharacterQuery.isError}
                onRetryFullRecord={() => void selectedCharacterQuery.refetch()}
              />
            ) : (
              <CharacterLibraryEmptyState
                title="Select a card"
                description="Pick a character from the grid to see a larger overview before editing."
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
