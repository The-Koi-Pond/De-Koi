import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../../../../shared/lib/utils";
import {
  blockLabel,
  entryBadgeTone,
  estimateTokens,
  formatCount,
  HISTORY_BADGE_TONE,
  plural,
  sectionBadgeTone,
} from "./format";
import type { HistoryBlock, HistoryEntry, PromptBlock, SectionBlock } from "./prompt-blocks";

const MUTED = "text-[var(--muted-foreground)]";
// Size classes go before `leading-relaxed`: tailwind-merge drops a line height that comes before a font size.
const PRE = "whitespace-pre-wrap break-words leading-relaxed text-[var(--foreground)]/80";
const PREVIEW_CHARS = 80;

function Chevron({ open, className }: { open: boolean; className: string }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return <Icon aria-hidden="true" className={cn("shrink-0", MUTED, className)} />;
}

function tokenText(tokens: number) {
  return `~${formatCount(tokens)} ${plural(tokens, "token")}`;
}

function BlockFrame({
  open,
  onToggle,
  header,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        <Chevron open={open} className="h-3 w-3" />
        {header}
      </button>
      {open && children}
    </div>
  );
}

const BADGE = "rounded-md px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider";

function useToggle() {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen((value) => !value)] as const;
}

function SectionView({ block }: { block: SectionBlock }) {
  const [open, onToggle] = useToggle();
  return (
    <BlockFrame
      open={open}
      onToggle={onToggle}
      header={
        <>
          <span className={cn(BADGE, sectionBadgeTone(block.label, block.role))}>{blockLabel(block.label)}</span>
          <span className={cn("ml-auto text-[0.625rem]", MUTED)}>{tokenText(estimateTokens(block.content))}</span>
        </>
      }
    >
      <div className="border-t border-[var(--border)]/50 px-3 py-2">
        <pre className={cn("text-xs", PRE)}>{block.content}</pre>
      </div>
    </BlockFrame>
  );
}

function EntryView({ entry }: { entry: HistoryEntry }) {
  const [open, onToggle] = useToggle();
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)]/30 bg-[var(--background)]/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--accent)]/30"
      >
        <Chevron open={open} className="h-2.5 w-2.5" />
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider",
            entryBadgeTone(entry.role),
          )}
        >
          {entry.role}
        </span>
        {!open && (
          <span className={cn("min-w-0 flex-1 truncate text-[0.625rem]", MUTED)}>
            {entry.content.split("\n")[0]!.slice(0, PREVIEW_CHARS)}
          </span>
        )}
        <span className={cn("ml-auto shrink-0 text-[0.5625rem]", MUTED)}>
          ~{formatCount(estimateTokens(entry.content))}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/30 px-2.5 py-1.5">
          <pre className={cn("text-[0.6875rem]", PRE)}>{entry.content}</pre>
        </div>
      )}
    </div>
  );
}

function HistoryView({ block }: { block: HistoryBlock }) {
  const [open, onToggle] = useToggle();
  const count = block.entries.length;
  const tokens = estimateTokens(block.entries.map((entry) => entry.content).join("\n\n"));
  return (
    <BlockFrame
      open={open}
      onToggle={onToggle}
      header={
        <>
          <span className={cn(BADGE, HISTORY_BADGE_TONE)}>Chat History</span>
          <span className={cn("text-[0.625rem]", MUTED)}>
            {count} {plural(count, "message")}
          </span>
          <span className={cn("ml-auto text-[0.625rem]", MUTED)}>{tokenText(tokens)}</span>
        </>
      }
    >
      <div className="space-y-1 border-t border-[var(--border)]/50 p-2">
        {block.entries.map((entry, i) => (
          <EntryView key={i} entry={entry} />
        ))}
      </div>
    </BlockFrame>
  );
}

/**
 * The prompt's blocks. Each block and history entry keeps its own open state at its position in the list, so a data
 * change keeps the state of the block at the same position; hiding the list (loading, error) resets it.
 */
export function BlockList({ blocks }: { blocks: PromptBlock[] }) {
  return blocks.map((block, index) =>
    block.kind === "history" ? <HistoryView key={index} block={block} /> : <SectionView key={index} block={block} />,
  );
}
