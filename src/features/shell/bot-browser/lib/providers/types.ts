import type { CharacterDetailImportData } from "../character-detail-merge";

/** Stored contract: these ids key the saved browser settings, the source marker and the provider marker. */
export type ProviderId = "chub" | "janny" | "chartavern" | "pygmalion" | "wyvern" | "datacat";

export type StatIcon = "star" | "download" | "heart" | "eye" | "message" | "hash";

export interface CardStat {
  value: number;
  label: string;
  icon: StatIcon;
}

/** One search result, the same shape for every provider. */
export interface BrowserCard {
  id: string;
  name: string;
  creator: string;
  tagline: string;
  tags: string[];
  /** A `tauri-api:` proxy source or an ordinary URL; null when the character has no picture. */
  picture: string | null;
  stats: CardStat[];
  nsfw: boolean;
  link: string;
  /** The site's own hit, kept for the detail fetch. */
  raw: unknown;
}

/** What a detail fetch found. Field names match the import merge's so the detail can go straight into it. */
export interface CharacterDetail extends Omit<CharacterDetailImportData, "name" | "creator" | "tags"> {
  /** The site says the character has a lorebook, whether or not it came with the detail. */
  hasLorebook?: boolean;
}

export interface ProviderSort {
  value: string;
  label: string;
  group?: string;
}

/** A check box under "Character must have": a feature the site can require, or an extra toggle. */
interface ProviderFilter {
  key: string;
  label: string;
}

/**
 * How the NSFW toggle works: an ordinary toggle, unlocked by logging in, chosen through the sort, or always on.
 */
type NsfwMode = "free" | "login" | "sort" | "locked";

export interface SearchCriteria {
  search: string;
  sort: string;
  /** 1-based. */
  page: number;
  nsfw: boolean;
  ascending: boolean;
  minTokens: string;
  maxTokens: string;
  /** Checked features and toggles, by key. */
  filters: Record<string, boolean>;
  includeTags: string[];
  excludeTags: string[];
}

export interface SearchResult {
  cards: BrowserCard[];
  total: number;
  /** How many characters the site returned for this page, before any tag checks on this side. */
  pageHits: number;
  /** Things the user should know about these results (shown above the grid). */
  notices: string[];
}

interface ProviderLogin {
  /** What the dialog asks for and what Rust stores. */
  kind: "token" | "cookie";
  sessionPath: string;
  savePath: string;
  validatePath: string;
  logoutPath: string;
}

export interface BrowserProvider {
  id: ProviderId;
  name: string;
  icon: string;
  /** The site's name in "View on <site>". */
  site: string;
  pageSize: number;
  defaultSort: string;
  sorts: ProviderSort[];
  features: ProviderFilter[];
  toggles: ProviderFilter[];
  hasSortDirection: boolean;
  hasTokenFilters: boolean;
  nsfwMode: NsfwMode;
  /** PNG: import the site's own card file; built: build the card from the detail. */
  importKind: "png" | "built";
  /** Whether an import fetches the detail itself when none is open (else it imports without one). */
  importFetchesDetail: boolean;
  /** For PNG imports: the Bot Browser path of the card file. */
  downloadPath?: (card: BrowserCard) => string;
  login?: ProviderLogin;
  /** Tag names the tag panel offers before any search (DataCat's most used). */
  suggestedTags?: () => string[];
  search: (criteria: SearchCriteria) => Promise<SearchResult>;
  /** A thrown error is shown with Retry; null means the site had nothing usable. */
  fetchDetail: (card: BrowserCard) => Promise<CharacterDetail | null>;
}
