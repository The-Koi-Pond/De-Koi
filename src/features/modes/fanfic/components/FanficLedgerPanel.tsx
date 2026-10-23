import { useMemo } from "react";
import { BookMarked, Loader2, Square } from "lucide-react";
import { useChat } from "../../../catalog/chats/index";
import { HelperRunNote } from "../../../catalog/connections/index";
import type { FanficLedgerEntry, FanficLedgerFact } from "../../../../engine/contracts/types/fanfic";
import { fanficLedgerStatus, readFanficLedger } from "../../../../engine/modes/fanfic/ledger";
import { fanficChapterViewRefs, type FanficChapterView, type FanficLedgerController } from "../hooks/use-fanfic";
import { FanficButton } from "./fanfic-ui";

function FactList({ title, facts }: { title: string; facts: FanficLedgerFact[] }) {
  if (facts.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--foreground)]">{title}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5 text-xs leading-snug text-[var(--muted-foreground)]">
        {facts.map((fact) => (
          <li key={`${fact.subject}-${fact.detail}`}>
            <span className="font-medium text-[var(--foreground)]/90">{fact.subject}:</span> {fact.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StandingFacts({ entry }: { entry: FanficLedgerEntry }) {
  return (
    <div className="flex flex-col gap-2">
      {entry.timeline && (
        <p className="text-xs text-[var(--muted-foreground)]">
          <span className="font-semibold text-[var(--foreground)]">When:</span> {entry.timeline}
        </p>
      )}
      <FactList title="Facts, and who knows them" facts={entry.knowledge} />
      <FactList title="Injuries, objects, and whereabouts" facts={entry.conditions} />
      <FactList title="Relationships" facts={entry.relationships} />
      {entry.openThreads.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--foreground)]">Open threads</p>
          <ul className="mt-0.5 list-disc pl-4 text-xs leading-snug text-[var(--muted-foreground)]">
            {entry.openThreads.map((thread) => (
              <li key={thread}>{thread}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const NOTE_CLASS = "mt-1 text-[0.6875rem] leading-snug text-[var(--muted-foreground)]";

/**
 * The story ledger: where things stand after the latest chapter it covers, and a line per chapter. Chapters are
 * written against it when the model can't hold every chapter, and continuity checks fall back on it for long fics.
 */
export function FanficLedgerPanel({
  chatId,
  chapters,
  ledger: controller,
  busy,
}: {
  chatId: string;
  chapters: FanficChapterView[];
  ledger: FanficLedgerController;
  busy: boolean;
}) {
  const { data: chat } = useChat(chatId);
  const refs = useMemo(() => fanficChapterViewRefs(chapters), [chapters]);
  const status = useMemo(() => fanficLedgerStatus(readFanficLedger(chat?.metadata), refs), [chat?.metadata, refs]);
  const latest = status.fresh[status.fresh.length - 1];
  const behind = status.stale.length;
  const { progress } = controller;

  let summary: string;
  if (controller.running) {
    summary = progress
      ? `Reading chapters… ${progress.done} of ${progress.total} done.`
      : "Getting the chapters ready to read…";
  } else if (!latest) {
    summary = `No ledger yet. Building it reads ${chapters.length === 1 ? "the chapter" : `all ${chapters.length} chapters`} once; after that each new chapter adds to it.`;
  } else if (behind > 0) {
    const first = status.stale[0]!;
    const last = status.stale[status.stale.length - 1]!;
    summary = `Up to date through chapter ${latest.chapter}. ${first === last ? `Chapter ${first} isn't` : `Chapters ${first}–${last} aren't`} in it yet.`;
  } else {
    summary = `Up to date through chapter ${latest.chapter}.`;
  }

  return (
    <section
      aria-label="Story ledger"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm sm:p-4"
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
          <BookMarked size="0.95rem" aria-hidden="true" />
          Story ledger
        </h3>
        <p className="mt-0.5 text-xs leading-snug text-[var(--muted-foreground)]">
          What the writer keeps straight between chapters: who knows what, injuries and objects, where things stand.
          When a fic gets too long for the model to read every chapter, it gets the ledger and the latest chapters
          instead.
        </p>
        <HelperRunNote task="fanficChecks" job="story ledger" chatId={chatId} className={NOTE_CLASS} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[0.8125rem] text-[var(--foreground)]" role="status">
          {controller.running && <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />}
          {summary}
        </p>
        {controller.running ? (
          <FanficButton onClick={controller.stop}>
            <Square size="0.8rem" aria-hidden="true" />
            Stop
          </FanficButton>
        ) : (
          (behind > 0 || !latest) &&
          chapters.length > 0 && (
            <FanficButton tone="primary" disabled={busy} onClick={() => controller.update()}>
              {latest ? "Update ledger" : "Build ledger"}
            </FanficButton>
          )
        )}
      </div>
      {latest && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 p-2.5">
            <p className="mb-1.5 text-[0.8125rem] font-semibold text-[var(--foreground)]">
              Where things stand after chapter {latest.chapter}
            </p>
            <StandingFacts entry={latest} />
          </div>
          <ol className="flex flex-col gap-1.5" aria-label="Chapter by chapter">
            {status.fresh.map((entry) => (
              <li key={entry.chapter}>
                <details className="group rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                  <summary className="cursor-pointer text-xs leading-snug text-[var(--foreground)]">
                    <span className="font-semibold">Chapter {entry.chapter}.</span> {entry.summary}
                  </summary>
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <StandingFacts entry={entry} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
