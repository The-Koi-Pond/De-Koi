// ──────────────────────────────────────────────
// UI: GIF Picker — GIPHY-powered search popover
// ──────────────────────────────────────────────
import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Loader2, ImageOff, ExternalLink, KeyRound, Save, Trash2 } from "lucide-react";
import { gifsApi, type GifConfigResponse } from "../../api/integration-utility-api";

interface GifResult {
  id: string;
  title: string;
  preview: string;
  url: string;
  width: number;
  height: number;
}

interface GifPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Container (e.g. input bar) whose top edge determines vertical placement */
  containerRef?: React.RefObject<HTMLElement | null>;
}

function isGiphyConfigError(message: string | null): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("giphy api key") || normalized.includes("giphy_api_key");
}

export function GifPicker({ open, onClose, onSelect, anchorRef, containerRef }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gifConfig, setGifConfig] = useState<GifConfigResponse | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [nextPos, setNextPos] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchingRef = useRef(false);
  const setupPanelActiveRef = useRef(false);
  const configHydratedRef = useRef(false);

  // Position state for portal
  const [pos, setPos] = useState<{ bottom: number; right?: number; left?: number }>({ bottom: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) return;
    const btnRect = anchorRef.current.getBoundingClientRect();
    const barRect = containerRef?.current?.getBoundingClientRect();
    const pad = 8;
    const pickerWidth = 384; // w-96 = 24rem

    // Vertical: pin bottom edge above the input bar's top edge
    const refTop = barRect ? barRect.top : btnRect.top;
    const bottom = window.innerHeight - refTop + pad;
    // Horizontal: on small screens center it, on larger screens align right edge to button
    const vw = window.innerWidth;
    if (vw < 480) {
      const left = Math.max(8, (vw - Math.min(pickerWidth, vw - 16)) / 2);
      setPos({ bottom, left });
    } else {
      const right = Math.max(8, window.innerWidth - btnRect.right);
      setPos({ bottom, right });
    }
  }, [open, anchorRef, containerRef]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const fetchGifs = useCallback(async (q: string, pos?: string) => {
    if (fetchingRef.current || setupPanelActiveRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await gifsApi.search({ q, limit: 20, pos });
      setupPanelActiveRef.current = false;
      if (pos) {
        setResults((prev) => [...prev, ...data.results]);
      } else {
        setResults(data.results);
      }
      setNextPos(data.next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch GIFs";
      setError(message);
      if (isGiphyConfigError(message)) {
        setupPanelActiveRef.current = true;
        if (!configHydratedRef.current) {
          try {
            setGifConfig(await gifsApi.config());
            configHydratedRef.current = true;
          } catch (configErr) {
            setConfigError(configErr instanceof Error ? configErr.message : "Failed to load GIPHY settings");
          }
        }
      }
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // Load trending on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setNextPos("");
      setApiKeyDraft("");
      setConfigError(null);
      setupPanelActiveRef.current = false;
      configHydratedRef.current = false;
      fetchGifs("");
    }
  }, [open, fetchGifs]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setResults([]);
      setNextPos("");
      fetchGifs(query);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, fetchGifs]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || !nextPos) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      fetchGifs(query, nextPos);
    }
  }, [loading, nextPos, query, fetchGifs]);

  const handleSelect = useCallback(
    (gif: GifResult) => {
      onSelect(gif.url);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleSaveApiKey = useCallback(async () => {
    const apiKey = apiKeyDraft.trim();
    if (!apiKey) {
      setConfigError("Paste a GIPHY API key before saving.");
      return;
    }
    setConfigSaving(true);
    setConfigError(null);
    try {
      setGifConfig(await gifsApi.updateConfig({ apiKey }));
      configHydratedRef.current = true;
      setupPanelActiveRef.current = false;
      setApiKeyDraft("");
      setError(null);
      fetchGifs(query);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Failed to save GIPHY settings");
    } finally {
      setConfigSaving(false);
    }
  }, [apiKeyDraft, fetchGifs, query]);

  const handleClearApiKey = useCallback(async () => {
    setConfigSaving(true);
    setConfigError(null);
    try {
      setGifConfig(await gifsApi.updateConfig({ apiKey: "" }));
      configHydratedRef.current = true;
      setupPanelActiveRef.current = false;
      setApiKeyDraft("");
      setError(null);
      fetchGifs(query);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Failed to clear GIPHY settings");
    } finally {
      setConfigSaving(false);
    }
  }, [fetchGifs, query]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] flex h-[26rem] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
      style={{
        bottom: pos.bottom,
        ...(pos.right != null ? { right: pos.right } : {}),
        ...(pos.left != null ? { left: pos.left } : {}),
      }}
    >
      {/* Search */}
      <div className="border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2 rounded-md bg-[var(--secondary)] px-2.5 py-1.5">
          <Search size="0.875rem" className="shrink-0 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for GIFs"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]/50"
            autoFocus
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-6 text-center">
          {isGiphyConfigError(error) ? (
            <>
              <KeyRound size="1.5rem" className="text-[var(--muted-foreground)]" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--foreground)]">GIPHY key required</p>
                <p className="text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
                  Save a GIPHY API key to search GIFs in De-Koi.
                </p>
              </div>
              <form
                className="flex w-full flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveApiKey();
                }}
              >
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  placeholder={gifConfig?.source === "stored" ? "Saved key" : "Paste GIPHY API key"}
                  className="w-full rounded-md bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)]/50 focus:ring-[var(--ring)]"
                />
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => void gifsApi.openApiKeyPage()}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <ExternalLink size="0.75rem" />
                    Get key
                  </button>
                  {gifConfig?.source === "stored" && (
                    <button
                      type="button"
                      onClick={() => void handleClearApiKey()}
                      disabled={configSaving}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                    >
                      <Trash2 size="0.75rem" />
                      Clear
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={configSaving || !apiKeyDraft.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-50"
                  >
                    {configSaving ? <Loader2 size="0.75rem" className="animate-spin" /> : <Save size="0.75rem" />}
                    Save
                  </button>
                </div>
              </form>
              {configError && <p className="text-[0.6875rem] text-[var(--destructive)]">{configError}</p>}
              {gifConfig?.envConfigured && (
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Environment key detected; a saved key overrides it.
                </p>
              )}
            </>
          ) : (
            <>
              <ImageOff size="1.5rem" className="text-[var(--muted-foreground)]" />
              <p className="text-xs text-[var(--muted-foreground)]">{error}</p>
            </>
          )}
        </div>
      )}

      {/* GIF grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-2" onScroll={handleScroll}>
        {results.length === 0 && !loading && !error && (
          <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">
            {query ? "No GIFs found" : "Loading trending..."}
          </p>
        )}

        {/* Masonry-ish 2-column layout */}
        <div className="columns-2 gap-1.5">
          {results.map((gif) => (
            <button
              key={gif.id}
              onClick={() => handleSelect(gif)}
              className="mb-1.5 block w-full overflow-hidden rounded-lg transition-transform hover:scale-[1.02] active:scale-100 break-inside-avoid"
              title={gif.title}
            >
              <img
                src={gif.preview || gif.url}
                alt={gif.title}
                className="w-full rounded-lg object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 size="1.25rem" className="animate-spin text-[var(--muted-foreground)]" />
          </div>
        )}
      </div>

      {/* GIPHY attribution */}
      <div className="flex items-center justify-center border-t border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.5625rem] text-[var(--muted-foreground)]/60">Powered by GIPHY</span>
      </div>
    </div>,
    document.body,
  );
}
