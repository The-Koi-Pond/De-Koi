import { useEffect, useId, useRef, useState } from "react";
import type { MessageExtra, MessageMemoryCaptureStatus } from "../../../../../engine/contracts/types/chat";
import { cn } from "../../../../../shared/lib/utils";

type MessageMemoryCapture = MessageExtra["memoryCapture"];
type MessageMemoryDisplayStatus = MessageMemoryCaptureStatus | "unsupported";
type MessageMemoryLifecycleStatus = Exclude<MessageMemoryDisplayStatus, "completed">;

const MEMORY_CAPTURE_STATUSES = new Set<MessageMemoryCaptureStatus>(["processing", "retryable", "failed", "completed"]);

const MEMORY_CAPTURE_LIFECYCLE_PRESENTATION: Record<
  MessageMemoryLifecycleStatus,
  { label: string; title: string; detail: string }
> = {
  processing: {
    label: "remembering…",
    title: "Remembering",
    detail: "De-Koi is checking this exchange for durable memory.",
  },
  retryable: {
    label: "memory retrying",
    title: "Memory retrying",
    detail: "Memory capture hit a temporary problem and will retry automatically.",
  },
  failed: {
    label: "memory unavailable",
    title: "Memory unavailable",
    detail: "Memory capture could not finish after several attempts. The conversation reply is still safe.",
  },
  unsupported: {
    label: "memory status unavailable",
    title: "Memory status unavailable",
    detail: "De-Koi found an unsupported saved memory status. It was not treated as remembered.",
  },
};

function normalizeMemoryCaptureStatus(value: unknown): MessageMemoryDisplayStatus {
  if (typeof value !== "string") return "unsupported";
  return MEMORY_CAPTURE_STATUSES.has(value as MessageMemoryCaptureStatus)
    ? (value as MessageMemoryCaptureStatus)
    : "unsupported";
}

// Reply metadata owns capture feedback only; recalled context stays in Peek Prompt.
interface MessageMemoryIndicatorsProps {
  isUser?: boolean;
  memoryCapture?: MessageMemoryCapture | null;
  className?: string;
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

export function MessageMemoryIndicators({ isUser, memoryCapture, className }: MessageMemoryIndicatorsProps) {
  const [savedOpen, setSavedOpen] = useState(false);
  const savedChipRef = useRef<HTMLButtonElement | null>(null);
  const savedPopoverRef = useRef<HTMLDivElement | null>(null);
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
  const savedMemories = savedConsequences.length > 0 ? savedConsequences : completeCapture ? [completeCapture] : [];
  const captureStatus = memoryCapture ? normalizeMemoryCaptureStatus(memoryCapture.status) : null;
  const captureHasProblems =
    memoryCapture?.consequences?.status === "skipped" ||
    savedConsequences.length < consequenceEntries.length ||
    (!!savedCapture && !completeCapture) ||
    (savedMemories.length === 0 && !completeCapture && memoryCapture?.consequences?.status !== "completed");
  const partialCapture = captureStatus === "completed" && savedMemories.length > 0 && captureHasProblems;
  const unavailableCapture = captureStatus === "completed" && savedMemories.length === 0 && captureHasProblems;
  const lifecycleStatus: MessageMemoryLifecycleStatus | null =
    !isUser && captureStatus && captureStatus !== "completed" ? captureStatus : null;
  const lifecyclePresentation = lifecycleStatus ? MEMORY_CAPTURE_LIFECYCLE_PRESENTATION[lifecycleStatus] : null;
  const remembered =
    !isUser && captureStatus === "completed" && (savedMemories.length > 0 || partialCapture || unavailableCapture);

  useEffect(() => {
    if (!savedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (savedChipRef.current?.contains(target) || savedPopoverRef.current?.contains(target)) return;
      setSavedOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSavedOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [savedOpen]);

  if (!remembered && !lifecycleStatus) return null;

  return (
    <span className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5", className)}>
      {(remembered || lifecycleStatus) && (
        <span className="relative inline-flex">
          <button
            ref={savedChipRef}
            type="button"
            aria-expanded={savedOpen}
            aria-haspopup="dialog"
            aria-controls={savedOpen ? savedTitleId : undefined}
            aria-label={lifecycleStatus ? "Open memory capture status" : "Open saved memory details"}
            title={lifecycleStatus ? "Show memory capture status" : "Show saved memory"}
            onClick={(event) => {
              event.stopPropagation();
              setSavedOpen((value) => !value);
            }}
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[0.5625rem] font-medium outline-none transition-colors duration-150 focus-visible:ring-1",
              lifecycleStatus
                ? "border-amber-400/20 bg-amber-400/10 text-amber-200/85 hover:bg-amber-400/15 focus-visible:ring-amber-300/45"
                : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300/80 hover:bg-emerald-400/15 focus-visible:ring-emerald-300/45",
            )}
          >
            {lifecyclePresentation?.label ??
              (partialCapture ? "⚠ partial memory" : unavailableCapture ? "⚠ memory unavailable" : "✦ remembered")}
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
                {lifecyclePresentation?.title ??
                  (partialCapture
                    ? "Partial memory capture"
                    : unavailableCapture
                      ? "Memory unavailable"
                      : savedMemories.length > 1
                        ? "Saved memories"
                        : savedMemories[0]?.operation === "updated"
                          ? "Updated memory"
                          : "Saved memory")}
              </div>
              {lifecyclePresentation?.detail && (
                <p className="rounded-md bg-amber-400/10 px-2 py-1.5 text-amber-100/90">
                  {lifecyclePresentation.detail}
                </p>
              )}
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
    </span>
  );
}
