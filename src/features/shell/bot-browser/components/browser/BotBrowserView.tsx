import {
  ArrowLeft,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tags,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { openExternalUrl } from "../../../../../shared/api/external-link-api";
import { saveFileToUserSelectedLocation } from "../../../../../shared/api/file-save-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { cn } from "../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useBrowserImport } from "../../hooks/use-browser-import";
import { useBrowserLogins } from "../../hooks/use-browser-logins";
import { useBrowserSearch } from "../../hooks/use-browser-search";
import { useOpenCharacter } from "../../hooks/use-open-character";
import { buildCardFields } from "../../lib/card-fields";
import { buildCharacterPng } from "../../lib/card-png-download";
import { totalPages } from "../../lib/format-stats";
import type { TagImportMode } from "../../lib/importing";
import { pngFileName } from "../../lib/png-card";
import { DEFAULT_PROVIDER_ID, providerById } from "../../lib/providers";
import type { BrowserCard, ProviderId, ProviderSort, SearchCriteria } from "../../lib/providers/types";
import { CharacterDetailView } from "./CharacterDetailView";
import { DatacatWarningDialog } from "./DatacatWarningDialog";
import { FiltersPanel, providerHasFilters } from "./FiltersPanel";
import { LoginDialog } from "./LoginDialog";
import { NsfwSwitch } from "./NsfwSwitch";
import { ProviderSwitcher } from "./ProviderSwitcher";
import { Pager, ResultsGrid } from "./ResultsGrid";
import { TagPanel } from "./TagPanel";

// Asked once per app session: after Continue, DataCat opens without the warning until the app reloads.
let datacatWarningAccepted = false;

const SEARCH_ERROR_FALLBACK = "Search didn't finish. Check your internet connection, then try again.";
const DOWNLOAD_ERROR_FALLBACK = "Couldn't download this character. Check your internet connection, then try again.";

function sortGroups(sorts: ProviderSort[]) {
  const groups: Array<{ label: string | null; sorts: ProviderSort[] }> = [];
  for (const sort of sorts) {
    const label = sort.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sorts.push(sort);
    else groups.push({ label, sorts: [sort] });
  }
  return groups;
}

function mergeTags(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((tag) => tag.toLowerCase()));
  const merged = [...current];
  for (const tag of incoming) {
    const key = tag.toLowerCase();
    if (!tag.trim() || seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged.length === current.length ? current : merged.sort((left, right) => left.localeCompare(right));
}

function openLink(url: string) {
  openExternalUrl(url).catch((error: unknown) => {
    toast.error(toUserMessage(error, { fallback: "Couldn't open that page. Try again." }));
  });
}

const toolbarButtonClass =
  "flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const toolbarActiveClass = "border-[var(--primary)]/60 bg-[var(--primary)]/10 text-[var(--primary)]";

/** The full-page Browser: search one site at a time, look at a character, import it. */
export function BotBrowserView() {
  const closeBotBrowser = useUIStore((s) => s.closeBotBrowser);

  const [providerId, setProviderId] = useState<ProviderId>(DEFAULT_PROVIDER_ID);
  const provider = providerById(providerId);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(provider.defaultSort);
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minTokens, setMinTokens] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [filters, setFilters] = useState<Record<string, boolean>>({});
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [datacatWarningOpen, setDatacatWarningOpen] = useState(false);
  const [tagImportMode, setTagImportMode] = useState<TagImportMode>("all");
  const [downloading, setDownloading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { open, openCharacter, close: closeCharacter } = useOpenCharacter();
  const { importing, runImport } = useBrowserImport();
  // The session checks run before the first search, so they are declared first.
  const logins = useBrowserLogins({ onAccountChanged: () => setPage(1) });
  const loggedIn = logins.isLoggedIn(provider);
  const nsfw = provider.nsfwMode === "locked" ? true : logins.settings.nsfw[provider.id] === true;

  const criteria = useMemo<SearchCriteria>(
    () => ({
      search,
      sort,
      page,
      nsfw,
      ascending,
      minTokens,
      maxTokens,
      filters,
      includeTags,
      excludeTags,
    }),
    [ascending, excludeTags, filters, includeTags, maxTokens, minTokens, nsfw, page, search, sort],
  );
  const { loading, error, result } = useBrowserSearch(provider, criteria, refreshKey);

  useEffect(() => {
    if (result)
      setKnownTags((current) =>
        mergeTags(
          current,
          result.cards.flatMap((card) => card.tags),
        ),
      );
  }, [result]);

  const switchProvider = useCallback(
    (id: ProviderId) => {
      const next = providerById(id);
      setProviderId(id);
      setSearch("");
      setSort(next.defaultSort);
      setAscending(false);
      setPage(1);
      setIncludeTags([]);
      setExcludeTags([]);
      setTagSearch("");
      setKnownTags([]);
      setTagPanelOpen(false);
      setFiltersOpen(false);
      setMinTokens("");
      setMaxTokens("");
      setFilters({});
      setLoginDialogOpen(false);
      closeCharacter();
    },
    [closeCharacter],
  );

  const pickProvider = (id: ProviderId) => {
    if (id === providerId) return;
    if (id === "datacat" && !datacatWarningAccepted) {
      setDatacatWarningOpen(true);
      return;
    }
    switchProvider(id);
  };

  const includeTag = (tag: string) => {
    setIncludeTags((current) => (current.includes(tag) ? current : [...current, tag]));
    setExcludeTags((current) => current.filter((item) => item !== tag));
    setPage(1);
  };
  const excludeTag = (tag: string) => {
    setExcludeTags((current) => (current.includes(tag) ? current : [...current, tag]));
    setIncludeTags((current) => current.filter((item) => item !== tag));
    setPage(1);
  };
  const removeTag = (tag: string) => {
    setIncludeTags((current) => current.filter((item) => item !== tag));
    setExcludeTags((current) => current.filter((item) => item !== tag));
    setPage(1);
  };
  const clearTags = () => {
    setIncludeTags([]);
    setExcludeTags([]);
    setPage(1);
  };

  const onNsfwClick = () => {
    switch (provider.nsfwMode) {
      case "free":
        logins.setNsfw(provider.id, !nsfw);
        setPage(1);
        return;
      case "login":
        if (!loggedIn) setLoginDialogOpen(true);
        return;
      case "sort":
        toast.info('Use the "Popular NSFW" sort option to browse NSFW content on Wyvern.');
        return;
      case "locked":
        return;
    }
  };

  const downloadPng = async (card: BrowserCard) => {
    if (!open) return;
    setDownloading(true);
    try {
      const detail = open.status === "ready" ? open.detail : null;
      const blob = await buildCharacterPng(buildCardFields(open.provider.id, card, detail), card.picture);
      const saved = await saveFileToUserSelectedLocation({
        filename: pngFileName(card.name),
        blob,
        title: "Export character PNG",
        filters: [{ name: "PNG", extensions: ["png"], mimeType: "image/png" }],
      });
      if (saved === "saved") toast.success(`Saved "${card.name}" as PNG character card!`);
      if (saved === "downloaded") toast.success(`Downloaded "${card.name}" as PNG character card!`);
    } catch (downloadError) {
      toast.error(toUserMessage(downloadError, { fallback: DOWNLOAD_ERROR_FALLBACK }));
    } finally {
      setDownloading(false);
    }
  };

  const tagsInUse = includeTags.length + excludeTags.length;
  const filtersOn = [...provider.features, ...provider.toggles].filter((item) => filters[item.key]).length;
  // DataCat's most used tags arrive with its first search, which re-renders the screen with the results.
  const tagList = mergeTags(knownTags, provider.suggestedTags?.() ?? []);
  const cards = result?.cards ?? [];
  const pages = totalPages(result?.total ?? 0, provider.pageSize);
  const loginLabel = provider.login?.kind === "token" ? "Logged in" : "Session active";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={closeBotBrowser}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
        >
          <ArrowLeft size="0.875rem" aria-hidden="true" />
          Back
        </button>
        <h1 className="text-base font-bold">Browser</h1>
        <ProviderSwitcher provider={provider} onPick={pickProvider} />
        <span className="flex-1" />
        {provider.login && loggedIn && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
            {loginLabel}
          </span>
        )}
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            size="0.875rem"
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search characters..."
            aria-label="Search characters"
            className="h-8 w-full rounded-md border border-[var(--input)] bg-[var(--secondary)] pl-8 pr-8 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X size="0.8125rem" aria-hidden="true" />
            </button>
          )}
        </div>

        <select
          aria-label="Sort"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(1);
          }}
          className="h-8 rounded-md border border-[var(--input)] bg-[var(--secondary)] px-2 text-sm text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {sortGroups(provider.sorts).map((group) =>
            group.label ? (
              <optgroup key={group.label} label={group.label}>
                {group.sorts.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              group.sorts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            ),
          )}
        </select>

        <button
          type="button"
          aria-expanded={tagPanelOpen}
          onClick={() => setTagPanelOpen((value) => !value)}
          className={cn(toolbarButtonClass, (tagPanelOpen || tagsInUse > 0) && toolbarActiveClass)}
        >
          <Tags size="0.8125rem" aria-hidden="true" />
          Tags
          {tagsInUse > 0 && <span className="tabular-nums">({tagsInUse})</span>}
        </button>

        {providerHasFilters(provider) && (
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
            className={cn(toolbarButtonClass, (filtersOpen || filtersOn > 0) && toolbarActiveClass)}
          >
            <SlidersHorizontal size="0.8125rem" aria-hidden="true" />
            Filters
            {filtersOn > 0 && <span className="tabular-nums">({filtersOn})</span>}
          </button>
        )}

        <NsfwSwitch provider={provider} nsfw={nsfw} loggedIn={loggedIn} onClick={onNsfwClick} />

        {provider.login &&
          (loggedIn ? (
            <>
              <span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
                NSFW depends on your account settings
              </span>
              <button
                type="button"
                disabled={logins.busy}
                onClick={() => void logins.logOut(provider)}
                className={toolbarButtonClass}
              >
                <LogOut size="0.8125rem" aria-hidden="true" />
                Log out
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setLoginDialogOpen(true)} className={toolbarButtonClass}>
              <LogIn size="0.8125rem" aria-hidden="true" />
              Log in
            </button>
          ))}

        {provider.nsfwMode === "sort" && (
          <span className="text-xs text-[var(--muted-foreground)]">Use the "Popular NSFW" sort for NSFW content.</span>
        )}

        <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className={toolbarButtonClass}>
          <RefreshCw size="0.8125rem" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {filtersOpen && providerHasFilters(provider) && (
        <FiltersPanel
          provider={provider}
          filters={filters}
          ascending={ascending}
          minTokens={minTokens}
          maxTokens={maxTokens}
          onToggleFilter={(key) => {
            setFilters((current) => ({ ...current, [key]: !current[key] }));
            setPage(1);
          }}
          onAscendingChange={(value) => {
            setAscending(value);
            setPage(1);
          }}
          onMinTokensChange={(value) => {
            setMinTokens(value);
            setPage(1);
          }}
          onMaxTokensChange={(value) => {
            setMaxTokens(value);
            setPage(1);
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto px-3 py-3">
          {open ? (
            <CharacterDetailView
              open={open}
              tagImportMode={tagImportMode}
              onTagImportModeChange={setTagImportMode}
              importing={importing}
              downloading={downloading}
              onBack={closeCharacter}
              onRetry={() => openCharacter(open.provider, open.card)}
              onImport={() =>
                void runImport({
                  provider: open.provider,
                  card: open.card,
                  openDetail: open.status === "ready" ? open.detail : undefined,
                  tagImportMode,
                })
              }
              onDownloadPng={() => void downloadPng(open.card)}
              onOpenLink={() => openLink(open.card.link)}
            />
          ) : (
            <>
              {result?.notices.map((notice) => (
                <p
                  key={notice}
                  role="note"
                  className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-[var(--foreground)]"
                >
                  <TriangleAlert size="0.875rem" aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500" />
                  {notice}
                </p>
              ))}
              {loading ? (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]"
                >
                  <Loader2 size="1.25rem" className="animate-spin" aria-hidden="true" />
                  Searching...
                </div>
              ) : error ? (
                <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
                  <p className="max-w-md text-sm text-[var(--foreground)]">
                    {toUserMessage(error, { fallback: SEARCH_ERROR_FALLBACK })}
                  </p>
                  <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className={toolbarButtonClass}>
                    <RefreshCw size="0.8125rem" aria-hidden="true" />
                    Retry
                  </button>
                </div>
              ) : cards.length === 0 ? (
                <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">No characters found</p>
              ) : (
                <ResultsGrid cards={cards} onOpen={(card) => openCharacter(provider, card)} />
              )}
              <Pager page={page} pages={pages} pageEmpty={!loading && cards.length === 0} onPage={setPage} />
            </>
          )}
        </main>

        {tagPanelOpen && (
          <TagPanel
            tags={tagList}
            includeTags={includeTags}
            excludeTags={excludeTags}
            tagSearch={tagSearch}
            onTagSearchChange={setTagSearch}
            onInclude={includeTag}
            onExclude={excludeTag}
            onRemove={removeTag}
            onClear={clearTags}
            onClose={() => setTagPanelOpen(false)}
          />
        )}
      </div>

      {loginDialogOpen && provider.login && (
        <LoginDialog
          provider={provider}
          loggedIn={loggedIn}
          busy={logins.busy}
          onClose={() => setLoginDialogOpen(false)}
          onSave={(value) =>
            void logins.logIn(provider, value).then((ok) => {
              if (ok) setLoginDialogOpen(false);
            })
          }
          onLogOut={() => void logins.logOut(provider)}
          onOpenLink={openLink}
        />
      )}

      {datacatWarningOpen && (
        <DatacatWarningDialog
          onCancel={() => setDatacatWarningOpen(false)}
          onContinue={() => {
            datacatWarningAccepted = true;
            setDatacatWarningOpen(false);
            switchProvider("datacat");
          }}
        />
      )}
    </div>
  );
}
