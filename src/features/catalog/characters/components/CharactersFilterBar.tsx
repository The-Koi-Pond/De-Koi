import { ChevronDown, Star, Tag } from "lucide-react";

import { cn } from "../../../../shared/lib/utils";
import {
  CatalogFilterPill,
  CatalogFilterRow,
  CatalogSearchStrip,
  TagFilterChip,
  TagFilterClear,
} from "../../components/CatalogPanelControls";
import type { FavoriteFilter, SortOption } from "../lib/characters-panel-model";

const SORT_OPTIONS: ReadonlyArray<{ value: SortOption; label: string; short?: string }> = [
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "favorites", label: "Favorites first", short: "Favs" },
];

export function CharactersFilterBar({
  search,
  onSearchChange,
  sort,
  onSortChange,
  favoriteFilter,
  onFavoriteFilterChange,
  allTags,
  tagsExpanded,
  onToggleTagsExpanded,
  includedTags,
  excludedTags,
  onClearTagFilters,
  onCycleTag,
  onDeleteTag,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
  favoriteFilter: FavoriteFilter;
  onFavoriteFilterChange: (value: FavoriteFilter) => void;
  allTags: string[];
  tagsExpanded: boolean;
  onToggleTagsExpanded: () => void;
  includedTags: ReadonlySet<string>;
  excludedTags: ReadonlySet<string>;
  onClearTagFilters: () => void;
  /** Clicking a tag cycles it: off → include → exclude → off. */
  onCycleTag: (tag: string) => void;
  onDeleteTag: (tag: string) => void;
}) {
  const hasTagFilters = includedTags.size > 0 || excludedTags.size > 0;

  return (
    <>
      <CatalogSearchStrip
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Search characters"
        hint="Search names, or narrow it down with name:, tag:, description: or personality:"
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={onSortChange}
      />

      {/* The tags open underneath the pills. */}
      <CatalogFilterRow label="Filter characters">
        {(["all", "favorites", "non-favorites"] as const).map((option) => (
          <CatalogFilterPill
            key={option}
            active={favoriteFilter === option}
            pressed={favoriteFilter === option}
            title={option === "all" ? "All characters" : option === "favorites" ? "Favorites only" : "Not favorites"}
            onClick={() => onFavoriteFilterChange(option)}
          >
            {option === "favorites" && <Star size="0.5625rem" className="shrink-0" aria-hidden="true" />}
            {option === "all" ? "All" : option === "favorites" ? "Favs" : "Non-favs"}
          </CatalogFilterPill>
        ))}
        {allTags.length > 0 && (
          <CatalogFilterPill
            active={hasTagFilters || tagsExpanded}
            expanded={tagsExpanded}
            onClick={onToggleTagsExpanded}
          >
            <Tag size="0.625rem" aria-hidden="true" />
            Tags ({allTags.length})
            {hasTagFilters && (
              <span className="ml-0.5 opacity-70">
                ·{" "}
                {[
                  includedTags.size > 0 ? `+${includedTags.size}` : null,
                  excludedTags.size > 0 ? `−${excludedTags.size}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            <ChevronDown size="0.625rem" className={cn("transition-transform", tagsExpanded && "rotate-180")} />
          </CatalogFilterPill>
        )}
      </CatalogFilterRow>

      {allTags.length > 0 && tagsExpanded && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)]/60 p-2">
          {hasTagFilters && <TagFilterClear onClear={onClearTagFilters} />}
          {allTags.map((tag) => (
            <TagFilterChip
              key={tag}
              tag={tag}
              mode={includedTags.has(tag) ? "include" : excludedTags.has(tag) ? "exclude" : undefined}
              onCycle={() => onCycleTag(tag)}
              onDelete={() => onDeleteTag(tag)}
            />
          ))}
        </div>
      )}
    </>
  );
}
