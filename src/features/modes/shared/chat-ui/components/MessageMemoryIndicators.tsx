import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  GenerationContextAttributionItem,
  GenerationPromptSnapshot,
  MessageExtra,
} from "../../../../../engine/contracts/types/chat";
import { cn } from "../../../../../shared/lib/utils";

type MessageMemoryCapture = MessageExtra["memoryCapture"];

interface MessageMemoryIndicatorsProps {
  isUser?: boolean;
  memoryCapture?: MessageMemoryCapture | null;
  promptSnapshot?: GenerationPromptSnapshot | null;
  onPeekPrompt?: (() => void) | null;
  className?: string;
}

function recalledMemoryItems(
  promptSnapshot: GenerationPromptSnapshot | null | undefined,
): GenerationContextAttributionItem[] {
  return (
    promptSnapshot?.contextAttribution?.items.filter(
      (item) => item.kind === "memory_recall" && item.status === "injected",
    ) ?? []
  );
}

function memoryLabel(count: number): string {
  return count === 1 ? "1 memory recalled" : `${count} memories recalled`;
}

const SAVED_MEMORY_OPERATIONS = new Set(["created", "updated", "superseded"]);
const SAVED_MEMORY_KINDS = new Set([
  "fact",
  "scene_event",
  "relationship_state",
  "preference",
  "promise",
  "plot_state",
  "contradiction",
]);
const SAVED_MEMORY_STATUSES = new Set(["active", "superseded", "stale"]);

function completeSavedMemory(
  entry: unknown,
): entry is NonNullable<NonNullable<MessageMemoryCapture>["consequences"]>["affected"][number] {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  const operation = String(value.operation);
  if (!SAVED_MEMORY_OPERATIONS.has(operation)) return false;
  if (!value.memory || typeof value.memory !== "object") return false;
  const memory = value.memory as Record<string, unknown>;
  const status = String(memory.status);
  if ((operation === "superseded") !== (status === "superseded")) return false;
  return (
    typeof memory.id === "string" &&
    memory.id.trim().length > 0 &&
    SAVED_MEMORY_KINDS.has(String(memory.kind)) &&
    SAVED_MEMORY_STATUSES.has(status) &&
    typeof memory.content === "string" &&
    memory.content.trim().length > 0
  );
}

export function MessageMemoryIndicators({
  isUser,
  memoryCapture,
  promptSnapshot,
  onPeekPrompt,
  className,
}: MessageMemoryIndicatorsProps) {
  const [open, setOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const savedChipRef = useRef<HTMLButtonElement | null>(null);
  const savedPopoverRef = useRef<HTMLDivElement | null>(null);
  const popoverAnchorRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const savedTitleId = useId();
  const savedCapture = memoryCapture?.capture;
  const consequenceEntries = memoryCapture?.consequences?.affected ?? [];
  const savedConsequences = consequenceEntries.filter(completeSavedMemory);
  const completeCapture =
    savedCapture?.memory &&
    typeof savedCapture.memory.id === "string" &&
    savedCapture.memory.id.trim().length > 0 &&
    typeof savedCapture.memory.content === "string" &&
    savedCapture.memory.content.trim().length > 0
      ? savedCapture
      : null;
  const savedMemories =
    savedConsequences.length > 0
      ? savedConsequences
      : completeCapture
        ? [completeCapture]
        : [];
  const captureHasProblems =
    memoryCapture?.consequences?.status === "skipped" ||
    savedConsequences.length < consequenceEntries.length ||
    (!!savedCapture && !completeCapture) ||
    (savedMemories.length === 0 && !completeCapture);
  const partialCapture = memoryCapture?.status === "completed" && savedMemories.length > 0 && captureHasProblems;
  const unavailableCapture =
    memoryCapture?.status === "completed" && savedMemories.length === 0 && captureHasProblems;
  const remembered =
    !isUser &&
    memoryCapture?.status === "completed" &&
    (savedMemories.length > 0 || partialCapture || unavailableCapture);
  const recalledItems = useMemo(() => recalledMemoryItems(promptSnapshot), [promptSnapshot]);
  const recalledCount = !isUser ? recalledItems.length : 0;
  const visibleSnippets = recalledItems
    .map((item) => item.snippet?.trim())
    .filter((snippet): snippet is string => !!snippet)
    .slice(0, 3);
  const hiddenCount = Math.max(0, recalledCount - visibleSnippets.length);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return;
    }

    const updatePopoverPosition = () => {
      const chipRect = chipRef.current?.getBoundingClientRect();
      const anchorRect = popoverAnchorRef.current?.getBoundingClientRect();
      if (!chipRect || !anchorRect) return;
      const viewportPadding = 16;
      const width = Math.min(288, Math.max(0, window.innerWidth - viewportPadding * 2));
      const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      const viewportLeft = Math.min(Math.max(chipRect.left, viewportPadding), maxLeft);
      setPopoverStyle({
        left: viewportLeft - anchorRect.left,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
        position: "absolute",
        width,
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open && !savedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        chipRef.current?.contains(target) ||
        popoverRef.current?.contains(target) ||
        savedChipRef.current?.contains(target) ||
        savedPopoverRef.current?.contains(target)
      )
        return;
      setOpen(false);
      setSavedOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      setSavedOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, savedOpen]);

  if (!remembered && recalledCount === 0) return null;

  return (
    <span className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5", className)}>
      {remembered && (
        <span className="relative inline-flex">
          <button
            ref={savedChipRef}
            type="button"
            aria-expanded={savedOpen}
            aria-haspopup="dialog"
            aria-controls={savedOpen ? savedTitleId : undefined}
            aria-label="Open saved memory details"
            title="Show saved memory"
            onClick={(event) => {
              event.stopPropagation();
              setSavedOpen((value) => !value);
            }}
            className="inline-flex shrink-0 items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-emerald-300/80 outline-none transition-colors duration-150 hover:bg-emerald-400/15 focus-visible:ring-1 focus-visible:ring-emerald-300/45"
          >
            {partialCapture ? "⚠ partial memory" : unavailableCapture ? "⚠ memory unavailable" : "✦ remembered"}
          </button>
          {savedOpen && (
            <div
              ref={savedPopoverRef}
              role="dialog"
              aria-labelledby={savedTitleId}
              className="absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-left text-[0.6875rem] shadow-xl shadow-black/25"
              onClick={(event) => event.stopPropagation()}
            >
              <div id={savedTitleId} className="mb-2 font-semibold text-[var(--foreground)]">
                {partialCapture
                  ? "Partial memory capture"
                  : unavailableCapture
                    ? "Memory unavailable"
                    : savedMemories.length > 1
                      ? "Saved memories"
                      : savedMemories[0]?.operation === "updated"
                        ? "Updated memory"
                        : "Saved memory"}
              </div>
              {partialCapture && (
                <p className="mb-2 rounded-md bg-amber-400/10 px-2 py-1.5 text-amber-200/90">
                  Some memory details could not be saved or verified.
                </p>
              )}
              {unavailableCapture && (
                <p className="mb-2 rounded-md bg-amber-400/10 px-2 py-1.5 text-amber-200/90">
                  No memory details could be saved or verified.
                </p>
              )}
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {savedMemories.map((entry) => (
                  <div
                    key={entry.memory.id}
                    className="rounded-md bg-[var(--accent)]/35 px-2 py-1.5 leading-relaxed text-[var(--foreground)]/80"
                  >
                    {"kind" in entry.memory && "status" in entry.memory && (
                      <div className="mb-1 text-[0.5625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                        {String(entry.memory.kind)} / {String(entry.memory.status)} / {entry.operation}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{entry.memory.content}</p>
                    <code className="mt-1 block break-all text-[0.5625rem] text-[var(--muted-foreground)]">
                      {entry.memory.id}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </span>
      )}
      {recalledCount > 0 && (
        <span ref={popoverAnchorRef} className="relative inline-flex">
          <button
            ref={chipRef}
            type="button"
            className="inline-flex shrink-0 items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-300/80 outline-none transition-colors duration-150 hover:bg-sky-400/15 focus-visible:ring-1 focus-visible:ring-sky-300/45"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={open ? titleId : undefined}
            aria-label={`Open recalled memory details for ${memoryLabel(recalledCount)}`}
            title={`Show ${memoryLabel(recalledCount)}`}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
          >
            💭 {memoryLabel(recalledCount)}
          </button>
          {open && (
            <div
              ref={popoverRef}
              role="dialog"
              aria-labelledby={titleId}
              className="absolute top-full z-50 mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-left text-[0.6875rem] shadow-xl shadow-black/25"
              style={popoverStyle ?? undefined}
              onClick={(event) => event.stopPropagation()}
            >
              <div id={titleId} className="mb-2 text-[0.6875rem] font-semibold text-[var(--foreground)]">
                Recalled memories
              </div>
              <div className="space-y-1.5">
                {visibleSnippets.length > 0 ? (
                  visibleSnippets.map((snippet, index) => (
                    <p
                      key={`${snippet}-${index}`}
                      className="max-h-16 overflow-hidden rounded-md bg-[var(--accent)]/35 px-2 py-1.5 leading-relaxed text-[var(--foreground)]/80"
                    >
                      I remembered: {snippet}
                    </p>
                  ))
                ) : (
                  <p className="rounded-md bg-[var(--accent)]/35 px-2 py-1.5 text-[var(--muted-foreground)]">
                    Recalled source details are unavailable for this response.
                  </p>
                )}
                {hiddenCount > 0 && (
                  <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]">+{hiddenCount} more</p>
                )}
              </div>
              {onPeekPrompt && (
                <button
                  type="button"
                  className="mt-2 inline-flex rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem] font-medium text-[var(--foreground)]/80 transition-colors hover:bg-[var(--accent)]"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    onPeekPrompt();
                  }}
                >
                  Open Peek Prompt
                </button>
              )}
            </div>
          )}
        </span>
      )}
    </span>
  );
}
