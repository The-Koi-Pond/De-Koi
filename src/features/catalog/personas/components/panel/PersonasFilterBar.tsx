import { ChevronDown, Star, Tag } from "lucide-react";

import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { cn } from "../../../../../shared/lib/utils";
import {
  CatalogFilterPill,
  CatalogFilterRow,
  CatalogSearchStrip,
  TagFilterChip,
  TagFilterClear,
  tagFilterSummary,
} from "../../../components/CatalogPanelControls";
import { hasTagFilters, type TagFilters } from "../../../lib/tag-filters";
import type { PersonaActiveFilter, SortOption } from "../../lib/personas-panel-model";

const SORT_OPTIONS: ReadonlyArray<{ value: SortOption; label: string }> = [
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "tokens", label: "Tokens" },
];

interface PersonasFilterBarProps {
  search: string;
  sort: SortOption;
  activeFilter: PersonaActiveFilter;
  allTags: string[];
  tagFilters: TagFilters;
  tagsExpanded: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (value: SortOption) => void;
  onActiveFilterChange: (value: PersonaActiveFilter) => void;
  /** Clicking a tag cycles it: off → include → exclude → off. */
  onCycleTag: (tag: string) => void;
  onClearTagFilters: () => void;
  onTagsExpandedChange: (value: boolean) => void;
  onDeleteTag: (tag: string) => void;
}

export function PersonasFilterBar({
  search,
  sort,
  activeFilter,
  allTags,
  tagFilters,
  tagsExpanded,
  onSearchChange,
  onSortChange,
  onActiveFilterChange,
  onCycleTag,
  onClearTagFilters,
  onTagsExpandedChange,
  onDeleteTag,
}: PersonasFilterBarProps) {
  const filtering = hasTagFilters(tagFilters);
  const summary = tagFilterSummary(tagFilters);
  return (
    <>
      <CatalogSearchStrip
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Search personas"
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={onSortChange}
      />

      {/* The tags open underneath the pills; "what's a persona?" sits at the row's end. */}
      <CatalogFilterRow label="Filter personas">
        {(["all", "active", "inactive"] as const).map((option) => (
          <CatalogFilterPill
            key={option}
            tone="jade"
            active={activeFilter === option}
            pressed={activeFilter === option}
            title={option === "all" ? "All personas" : option === "active" ? "The persona in use" : "The others"}
            onClick={() => onActiveFilterChange(option)}
          >
            {option === "active" && <Star size="0.5625rem" className="shrink-0" aria-hidden="true" />}
            {option === "all" ? "All" : option === "active" ? "Active" : "Inactive"}
          </CatalogFilterPill>
        ))}
        {allTags.length > 0 && (
          <CatalogFilterPill
            tone="jade"
            active={filtering || tagsExpanded}
            expanded={tagsExpanded}
            onClick={() => onTagsExpandedChange(!tagsExpanded)}
          >
            <Tag size="0.625rem" aria-hidden="true" />
            Tags ({allTags.length}){summary && <span className="ml-0.5 opacity-70">· {summary}</span>}
            <ChevronDown size="0.625rem" className={cn("transition-transform", tagsExpanded && "rotate-180")} />
          </CatalogFilterPill>
        )}
        <span className="ml-auto flex">
          <HelpTooltip text="Personas are your different identities. The active persona determines how the AI refers to you and sees your description, personality, backstory, and appearance. Great for switching between different player characters!" />
        </span>
      </CatalogFilterRow>

      {allTags.length > 0 && tagsExpanded && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)]/60 p-2">
          {filtering && <TagFilterClear onClear={onClearTagFilters} />}
          {allTags.map((tag) => (
            <TagFilterChip
              key={tag}
              tag={tag}
              tone="jade"
              mode={tagFilters[tag]}
              onCycle={() => onCycleTag(tag)}
              onDelete={() => onDeleteTag(tag)}
            />
          ))}
        </div>
      )}
    </>
  );
}
