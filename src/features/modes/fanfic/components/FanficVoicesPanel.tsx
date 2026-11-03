import { useEffect, useState, type ReactNode } from "react";
import { Loader2, MessageSquareQuote, RefreshCw, Save, Square, X } from "lucide-react";
import type { FanficVoiceSheet } from "../../../../engine/contracts/types/fanfic";
import { FANFIC_VOICE_LIMITS } from "../../../../engine/modes/fanfic/request";
import type { FanficVoicePhase } from "../../../../engine/modes/fanfic/voices";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { cn } from "../../../../shared/lib/utils";
import type { FanficVoicesController } from "../hooks/use-fanfic";
import { FanficButton, FanficWaitNote, fanficInputClass } from "./fanfic-ui";

const PHASE_LABELS: Record<FanficVoicePhase, string> = {
  finding_quotes: "Reading pages that quote the characters…",
  writing_sheets: "Writing the voice sheets…",
};

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function sameSheets(a: readonly FanficVoiceSheet[], b: readonly FanficVoiceSheet[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function SheetEditor({
  sheet,
  index,
  onChange,
}: {
  sheet: FanficVoiceSheet;
  index: number;
  onChange: (sheet: FanficVoiceSheet) => void;
}) {
  const id = `fanfic-voice-${index}`;
  const [neverSays, setNeverSays] = useState(sheet.neverSays.join("\n"));
  const neverKey = sheet.neverSays.join("\n");
  // Keep the text as typed (a new empty line included) unless the list itself changed from outside.
  useEffect(() => {
    setNeverSays((typed) => (splitLines(typed).join("\n") === neverKey ? typed : neverKey));
  }, [neverKey]);
  return (
    <details
      className="group rounded-lg border border-[var(--border)] bg-[var(--secondary)]/20 p-2.5"
      open={index === 0}
    >
      <summary className="cursor-pointer text-[0.8125rem] font-semibold text-[var(--foreground)]">
        {sheet.name}
        <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
          {sheet.quotes.length > 0
            ? `${sheet.quotes.length} canon ${sheet.quotes.length === 1 ? "line" : "lines"}`
            : "no canon lines"}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-speech`} className="text-xs font-semibold text-[var(--foreground)]">
            How they talk
          </label>
          <textarea
            id={`${id}-speech`}
            rows={5}
            className={cn(fanficInputClass, "resize-y text-xs leading-relaxed")}
            value={sheet.speech}
            onChange={(event) => onChange({ ...sheet, speech: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-never`} className="text-xs font-semibold text-[var(--foreground)]">
            Never says{" "}
            <span className="font-normal text-[var(--muted-foreground)]">
              (one per line, up to {FANFIC_VOICE_LIMITS.neverSays})
            </span>
          </label>
          <textarea
            id={`${id}-never`}
            rows={4}
            className={cn(fanficInputClass, "resize-y text-xs leading-relaxed")}
            value={neverSays}
            onChange={(event) => {
              setNeverSays(event.target.value);
              onChange({
                ...sheet,
                neverSays: splitLines(event.target.value),
              });
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-motives`} className="text-xs font-semibold text-[var(--foreground)]">
            What drives them
          </label>
          <textarea
            id={`${id}-motives`}
            rows={3}
            className={cn(fanficInputClass, "resize-y text-xs leading-relaxed")}
            value={sheet.motives}
            onChange={(event) => onChange({ ...sheet, motives: event.target.value })}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-[var(--foreground)]">Canon lines</p>
          {sheet.quotes.length === 0 ? (
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              None found. Lines only appear here when they're on a page research read, word for word.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {sheet.quotes.map((quote, quoteIndex) => (
                <li key={quote.text} className="flex items-start gap-2 text-xs leading-snug">
                  <p className="min-w-0 flex-1 text-[var(--muted-foreground)]">
                    “{quote.text}”{" "}
                    <a
                      href={quote.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="whitespace-nowrap text-[var(--primary)] underline-offset-2 hover:underline"
                    >
                      {quote.source}
                    </a>
                  </p>
                  <button
                    type="button"
                    aria-label={`Remove this line from ${sheet.name}'s sheet`}
                    onClick={() =>
                      onChange({ ...sheet, quotes: sheet.quotes.filter((_, other) => other !== quoteIndex) })
                    }
                    className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                  >
                    <X size="0.8rem" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

/**
 * The fic's voice sheets: how each character talks, words they'd never use, what drives them, and real canon lines.
 * Chapters are written to them and the voice check measures lines against them. Edits save on Save.
 */
export function FanficVoicesPanel({
  voices,
  controller,
  canBuild,
  busy,
  onSave,
  helperNote,
}: {
  voices: FanficVoiceSheet[];
  controller: FanficVoicesController;
  /** False when the request names no characters. */
  canBuild: boolean;
  busy: boolean;
  onSave: (voices: FanficVoiceSheet[]) => Promise<void>;
  /** Where this helper last ran for this fic, and why (Helper Models). */
  helperNote?: ReactNode;
}) {
  const [draft, setDraft] = useState(voices);
  const [saving, setSaving] = useState(false);
  // Reset only when the saved sheets change (a build or a save), not when other metadata re-renders the fic.
  const savedKey = JSON.stringify(voices);
  useEffect(() => setDraft(JSON.parse(savedKey) as FanficVoiceSheet[]), [savedKey]);
  const dirty = !sameSheets(draft, voices);

  const rebuild = async () => {
    if (voices.length > 0) {
      const confirmed = await showConfirmDialog({
        title: "Rebuild voice sheets",
        message: "Rebuilding writes new sheets and replaces these, including your edits.",
        confirmLabel: "Rebuild",
      });
      if (!confirmed) return;
    }
    controller.build();
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Voice sheets"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4"
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
          <MessageSquareQuote size="0.95rem" aria-hidden="true" />
          Voice sheets
        </h3>
        <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">
          How each character talks. Chapters are written to these, and Check voice measures lines against them. Canon
          lines come from pages research read, never from character cards.
        </p>
        {helperNote}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {controller.running ? (
          <>
            <VoicesStatus key={controller.phase ?? "starting"} phase={controller.phase} />
            <FanficButton onClick={controller.stop}>
              <Square size="0.8rem" aria-hidden="true" />
              Stop
            </FanficButton>
          </>
        ) : (
          <>
            {!canBuild && (
              <p className="text-[0.8125rem] text-[var(--muted-foreground)]">
                Name the characters in the request to build voice sheets.
              </p>
            )}
            {canBuild && (
              <FanficButton
                tone={voices.length === 0 ? "primary" : undefined}
                disabled={busy || saving}
                onClick={() => void rebuild()}
              >
                <RefreshCw size="0.85rem" aria-hidden="true" />
                {voices.length === 0 ? "Build voice sheets" : "Rebuild"}
              </FanficButton>
            )}
            {dirty && (
              <>
                <FanficButton tone="primary" disabled={saving} onClick={() => void save()}>
                  {saving ? (
                    <Loader2 size="0.85rem" className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save size="0.85rem" aria-hidden="true" />
                  )}
                  Save changes
                </FanficButton>
                <FanficButton disabled={saving} onClick={() => setDraft(voices)}>
                  Undo changes
                </FanficButton>
              </>
            )}
          </>
        )}
      </div>
      {draft.length > 0 && (
        <div className="flex flex-col gap-2">
          {draft.map((sheet, index) => (
            <SheetEditor
              key={sheet.name}
              sheet={sheet}
              index={index}
              onChange={(next) =>
                setDraft((current) => current.map((entry, other) => (other === index ? next : entry)))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** One voice-sheet step; keyed by phase, so its clock starts again when the step changes. */
function VoicesStatus({ phase }: { phase: FanficVoicePhase | null }) {
  const [startedAt] = useState(() => Date.now());
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[0.8125rem] text-[var(--foreground)]" role="status">
        <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />
        {phase ? PHASE_LABELS[phase] : "Starting…"}
      </p>
      <FanficWaitNote startedAt={startedAt} stopLabel="Stop" />
    </div>
  );
}
