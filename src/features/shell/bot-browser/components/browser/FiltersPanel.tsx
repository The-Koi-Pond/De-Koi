import type { BrowserProvider } from "../../lib/providers/types";

/** Whether a provider has anything for the Filters panel. */
export function providerHasFilters(provider: BrowserProvider): boolean {
  return (
    provider.features.length > 0 || provider.toggles.length > 0 || provider.hasSortDirection || provider.hasTokenFilters
  );
}

const fieldClass =
  "h-8 w-full rounded-md border border-[var(--input)] bg-[var(--secondary)] px-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function FiltersPanel({
  provider,
  filters,
  ascending,
  minTokens,
  maxTokens,
  onToggleFilter,
  onAscendingChange,
  onMinTokensChange,
  onMaxTokensChange,
}: {
  provider: BrowserProvider;
  filters: Record<string, boolean>;
  ascending: boolean;
  minTokens: string;
  maxTokens: string;
  onToggleFilter: (key: string) => void;
  onAscendingChange: (ascending: boolean) => void;
  onMinTokensChange: (value: string) => void;
  onMaxTokensChange: (value: string) => void;
}) {
  const checks = [...provider.features, ...provider.toggles];
  const hasAdvanced = provider.hasSortDirection || provider.hasTokenFilters;

  return (
    <section
      aria-label="Filters"
      className="grid gap-4 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 sm:grid-cols-2"
    >
      {checks.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">Character must have</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {checks.map((check) => (
              <label key={check.key} className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={filters[check.key] === true}
                  onChange={() => onToggleFilter(check.key)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {check.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {hasAdvanced && (
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">Advanced options</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {provider.hasSortDirection && (
              <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                Sort direction
                <select
                  value={ascending ? "asc" : "desc"}
                  onChange={(event) => onAscendingChange(event.target.value === "asc")}
                  className={fieldClass}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </label>
            )}
            {provider.hasTokenFilters && (
              <>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                  Min tokens
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={minTokens}
                    placeholder="50"
                    onChange={(event) => onMinTokensChange(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                  Max tokens
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={maxTokens}
                    placeholder="100000"
                    onChange={(event) => onMaxTokensChange(event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}
