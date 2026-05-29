import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function isVisibleElement(element: HTMLElement) {
  if (element.closest("[data-app-find-overlay]")) return false;
  if (element.closest("[inert]")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function nearestSearchableElement(node: Node): HTMLElement | null {
  let element = node.parentElement;
  while (element && element !== document.body) {
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg"].includes(tag)) return null;
    if (isVisibleElement(element)) return element;
    element = element.parentElement;
  }
  return null;
}

function collectMatches(query: string): HTMLElement[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim();
      if (!text || !text.toLocaleLowerCase().includes(needle)) return NodeFilter.FILTER_REJECT;
      return nearestSearchableElement(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const matches: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  let node = walker.nextNode();
  while (node) {
    const element = nearestSearchableElement(node);
    if (element && !seen.has(element)) {
      seen.add(element);
      matches.push(element);
    }
    node = walker.nextNode();
  }
  return matches;
}

function selectedTextForFind() {
  const selection = window.getSelection()?.toString().trim() ?? "";
  return selection.length > 0 && selection.length <= 120 && !selection.includes("\n") ? selection : "";
}

export function AppFindOverlay() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  const clearActiveElement = useCallback(() => {
    activeElementRef.current?.removeAttribute("data-marinara-find-active");
    activeElementRef.current = null;
  }, []);

  const focusActiveMatch = useCallback(
    (nextMatches: HTMLElement[], nextIndex: number) => {
      clearActiveElement();
      const element = nextMatches[nextIndex];
      if (!element) return;
      element.setAttribute("data-marinara-find-active", "true");
      activeElementRef.current = element;
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    },
    [clearActiveElement],
  );

  const runSearch = useCallback(
    (value: string) => {
      const nextMatches = collectMatches(value);
      setMatches(nextMatches);
      setActiveIndex(0);
      focusActiveMatch(nextMatches, 0);
    },
    [focusActiveMatch],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const nextIndex = (activeIndex + direction + matches.length) % matches.length;
      setActiveIndex(nextIndex);
      focusActiveMatch(matches, nextIndex);
    },
    [activeIndex, focusActiveMatch, matches],
  );

  const close = useCallback(() => {
    setOpen(false);
    clearActiveElement();
  }, [clearActiveElement]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isFindShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFindShortcut) {
        event.preventDefault();
        const selected = selectedTextForFind();
        if (selected) {
          setQuery(selected);
          window.requestAnimationFrame(() => runSearch(selected));
        } else if (query.trim()) {
          window.requestAnimationFrame(() => runSearch(query));
        }
        setOpen(true);
        window.requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
        return;
      }

      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Enter" && isEditableTarget(event.target)) {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [close, open, query, runSearch, step]);

  useEffect(() => {
    if (!open) return;
    runSearch(query);
  }, [open, query, runSearch]);

  useEffect(() => clearActiveElement, [clearActiveElement]);

  if (!open) return null;

  return (
    <div
      data-app-find-overlay
      className="fixed right-4 top-[4.6rem] z-[80] flex min-w-[18rem] max-w-[calc(100vw-2rem)] items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--popover)]/95 p-1.5 text-xs text-[var(--foreground)] shadow-2xl backdrop-blur-xl"
    >
      <style>
        {`[data-marinara-find-active="true"] {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
}`}
      </style>
      <Search size="0.875rem" className="ml-1 shrink-0 text-[var(--muted-foreground)]" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find..."
        className="min-w-0 flex-1 bg-transparent px-1 py-1 outline-none placeholder:text-[var(--muted-foreground)]"
      />
      <span className="shrink-0 px-1 text-[0.65rem] tabular-nums text-[var(--muted-foreground)]">
        {query.trim() ? (matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : "0/0") : ""}
      </span>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={matches.length === 0}
        className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Previous match"
      >
        <ChevronUp size="0.875rem" />
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={matches.length === 0}
        className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Next match"
      >
        <ChevronDown size="0.875rem" />
      </button>
      <button
        type="button"
        onClick={close}
        className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        title="Close find"
      >
        <X size="0.875rem" />
      </button>
    </div>
  );
}
