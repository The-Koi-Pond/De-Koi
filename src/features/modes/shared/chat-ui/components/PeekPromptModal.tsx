// ──────────────────────────────────────────────
// Peek Prompt Modal — collapsible section viewer
// ──────────────────────────────────────────────
import { useState, useMemo } from "react";
import type { GenerationContextAttribution } from "../../../../../engine/contracts/types/chat";
import { X, ChevronRight, ChevronDown, Loader2, Gauge, AlertTriangle } from "lucide-react";
import { cn } from "../../../../../shared/lib/utils";
import { buildPromptAttributionViewModel, type PromptAttributionViewModel } from "../lib/prompt-attribution";
import { usePresetSummaries } from "../../../../catalog/presets/index";
import type { PromptBudgetEstimate } from "../../../../../engine/generation/prompt-budget";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

interface GenerationInfo {
  model?: string;
  provider?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  topK?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  showThoughts?: boolean | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  serviceTier?: string | null;
  assistantPrefill?: string | null;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  tokensCachedPrompt?: number | null;
  tokensCacheWritePrompt?: number | null;
  durationMs?: number | null;
  finishReason?: string | null;
}

type PeekPromptMessage = {
  role: string;
  content: string;
  contextKind?: "prompt" | "history" | "injection";
  displayName?: string;
  images?: string[];
};

interface PeekPromptModalProps {
  data: {
    messages: PeekPromptMessage[];
    previewMessages?: PeekPromptMessage[];
    parameters: unknown;
    promptPresetId?: string | null;
    contextAttribution?: GenerationContextAttribution | null;
    source?: "cached" | "live_preview" | "raw_messages";
    exact?: boolean;
    generationInfo?: GenerationInfo | null;
    agentNote?: string;
    loading?: boolean;
    error?: string;
    budget?: PromptBudgetEstimate;
  };
  onClose: () => void;
}

function sourceLabel(data: PeekPromptModalProps["data"]): string {
  if (data.exact) return "Exact Text Model Request";
  if (data.source === "live_preview") return "Live Preview";
  if (data.source === "raw_messages") return "Raw Messages";
  return "Prompt Preview";
}

function sourceBadgeClass(data: PeekPromptModalProps["data"]): string {
  if (data.exact) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function prettifyTag(tag: string): string {
  return tag.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ═══════════════════════════════════════════════
//  Section types for the final display list
// ═══════════════════════════════════════════════

interface SectionBlock {
  kind: "section";
  label: string;
  role: string;
  content: string;
}

interface ChatHistoryEntry {
  role: string;
  content: string;
}

interface ChatHistoryBlock {
  kind: "chat-history";
  entries: ChatHistoryEntry[];
  rawContent: string; // for token counting
}

type DisplaySection = SectionBlock | ChatHistoryBlock;

// ═══════════════════════════════════════════════
//  Parsing: works on the WHOLE messages array
// ═══════════════════════════════════════════════

/**
 * Parse XML sections from a single message's content.
 * Only matches tags whose opening AND closing appear on their own line
 * (prompt-level sections like <system_prompt>, <character_info>, etc.).
 * Returns named blocks; anything between/around sections becomes a block
 * named after the message role.
 */
function parseXmlSections(content: string, fallbackLabel: string, fallbackRole = fallbackLabel): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  // Match <tag_name>\n...\n</tag_name> where both tags sit on their own line.
  const tagRegex = /(?:^|\n)(<([a-z_][a-z0-9_-]*)>\n[\s\S]*?\n<\/\2>)(?:\n|$)/gi;
  let lastIndex = 0;

  for (const match of content.matchAll(tagRegex)) {
    const matchStart = match.index!;
    const realStart = content[matchStart] === "\n" ? matchStart + 1 : matchStart;
    const before = content.slice(lastIndex, realStart);
    if (before.trim()) {
      blocks.push({ kind: "section", label: fallbackLabel, role: fallbackRole, content: before.trim() });
    }
    const tagName = match[2]!;
    const tagContent = match[1]!;
    blocks.push({ kind: "section", label: tagName, role: fallbackRole, content: tagContent.trimEnd() });
    lastIndex = match.index! + match[0].length;
  }

  const remaining = content.slice(lastIndex);
  if (remaining.trim()) {
    blocks.push({ kind: "section", label: fallbackLabel, role: fallbackRole, content: remaining.trim() });
  }

  return blocks.length > 0 ? blocks : [{ kind: "section", label: fallbackLabel, role: fallbackRole, content }];
}

function appendPromptSections(result: DisplaySection[], msg: PeekPromptMessage): void {
  if (msg.contextKind === "injection" && msg.displayName === "Trackers") {
    result.push({
      kind: "section",
      label: msg.displayName,
      role: msg.role,
      content: msg.content.trim(),
    });
    return;
  }

  const openIdx = msg.content.search(/<last_message>/i);
  const closingIdx = msg.content.search(/<\/last_message>/i);
  if (openIdx >= 0 && closingIdx >= 0) {
    const beforeOpen = msg.content.slice(0, openIdx).trim();
    const innerContent = msg.content.slice(msg.content.indexOf(">", openIdx) + 1, closingIdx).trim();
    const afterClose = msg.content.slice(msg.content.indexOf(">", closingIdx) + 1).trim();

    if (beforeOpen) {
      const pre = parseXmlSections(beforeOpen, msg.displayName || msg.role, msg.role);
      for (const block of pre) result.push(block);
    }
    if (innerContent) {
      result.push({
        kind: "section",
        label: "last_message",
        role: msg.role,
        content: innerContent,
      });
    }
    if (afterClose) {
      const post = parseXmlSections(afterClose, msg.displayName || msg.role, msg.role);
      for (const block of post) result.push(block);
    }
    return;
  }

  if (/<last_message>/i.test(msg.content) || /^## Last Message\n/i.test(msg.content)) {
    const content = msg.content.replace(/^## Last Message\n?/i, "");
    result.push({
      kind: "section",
      label: "last_message",
      role: msg.role,
      content: content.trim(),
    });
    return;
  }

  const blocks = parseXmlSections(msg.content, msg.displayName || msg.role, msg.role);
  for (const block of blocks) result.push(block);
}

function buildDisplaySectionsFromContextKinds(messages: PeekPromptMessage[]): DisplaySection[] {
  const result: DisplaySection[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.contextKind !== "history") {
      appendPromptSections(result, msg);
      continue;
    }

    const entries: ChatHistoryEntry[] = [];
    const rawParts: string[] = [];
    for (; i < messages.length && messages[i]?.contextKind === "history"; i++) {
      const historyMessage = messages[i]!;
      const trimmed = historyMessage.content.trim();
      if (!trimmed) continue;
      entries.push({ role: historyMessage.role, content: trimmed });
      rawParts.push(trimmed);
    }
    i -= 1;

    if (entries.length > 0) {
      result.push({ kind: "chat-history", entries, rawContent: rawParts.join("\n\n") });
    }
  }

  return result;
}

/**
 * Build the display section list from the raw messages array.
 *
 * The key challenge: `<chat_history>` opens in one message and closes in another,
 * with bare user/assistant messages in between. We detect boundaries at the
 * array level first, then handle each region appropriately.
 */
function buildDisplaySections(messages: PeekPromptMessage[]): DisplaySection[] {
  if (messages.some((message) => message.contextKind)) {
    return buildDisplaySectionsFromContextKinds(messages);
  }

  // ── Pass 1: find chat history boundaries across the messages array ──
  let chStartIdx = -1;
  let chEndIdx = -1;
  let lastMsgIdx = -1; // <last_message> or ## Last Message

  for (let i = 0; i < messages.length; i++) {
    const c = messages[i]!.content;
    if (chStartIdx < 0 && (/<chat_history>/i.test(c) || /^## Chat History\n/i.test(c))) {
      chStartIdx = i;
    }
    if (/<\/chat_history>/i.test(c)) {
      chEndIdx = i;
    }
    if (/<last_message>/i.test(c) || /^## Last Message\n/i.test(c)) {
      lastMsgIdx = i;
    }
  }

  // If we found an opening tag but no explicit close, the history runs until
  // the message before <last_message>, or to the end of user/assistant messages.
  if (chStartIdx >= 0 && chEndIdx < 0) {
    if (lastMsgIdx > chStartIdx) {
      chEndIdx = lastMsgIdx - 1;
    } else {
      // Find the last consecutive user/assistant message after chStartIdx
      chEndIdx = chStartIdx;
      for (let i = chStartIdx + 1; i < messages.length; i++) {
        const r = messages[i]!.role;
        if (r === "user" || r === "assistant") chEndIdx = i;
        else break;
      }
    }
  }

  // ── Pass 2: build output sections ──
  const result: DisplaySection[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // ── Chat history region ──
    if (chStartIdx >= 0 && i >= chStartIdx && i <= chEndIdx) {
      // Collect all chat history entries in one pass
      const entries: ChatHistoryEntry[] = [];
      const rawParts: string[] = [];
      for (let j = chStartIdx; j <= chEndIdx; j++) {
        let content = messages[j]!.content;
        // Strip the wrapping tags from the content shown inside child blocks
        content = content
          .replace(/^<chat_history>\n?/i, "")
          .replace(/\n?<\/chat_history>\s*$/i, "")
          .replace(/^## Chat History\n?/i, "");
        const trimmed = content.trim();
        if (trimmed) {
          entries.push({ role: messages[j]!.role, content: trimmed });
          rawParts.push(trimmed);
        }
      }
      if (entries.length > 0) {
        result.push({ kind: "chat-history", entries, rawContent: rawParts.join("\n\n") });
      }
      i = chEndIdx; // skip past the whole range
      continue;
    }

    // ── Last message (separate from chat history) ──
    if (i === lastMsgIdx) {
      // The server may merge <last_message> with adjacent same-role sections
      // (e.g. <output_format>) when strict role formatting is on.
      // Split out the <last_message> portion and parse the rest normally.
      const openIdx = msg.content.search(/<last_message>/i);
      const closingIdx = msg.content.search(/<\/last_message>/i);
      if (openIdx >= 0 && closingIdx >= 0) {
        const beforeOpen = msg.content.slice(0, openIdx).trim();
        const innerContent = msg.content.slice(msg.content.indexOf(">", openIdx) + 1, closingIdx).trim();
        const afterClose = msg.content.slice(msg.content.indexOf(">", closingIdx) + 1).trim();

        // Content before <last_message>
        if (beforeOpen) {
          const pre = parseXmlSections(beforeOpen, msg.role);
          for (const b of pre) result.push(b);
        }
        // The last_message block itself
        if (innerContent) {
          result.push({
            kind: "section",
            label: "last_message",
            role: msg.role,
            content: innerContent,
          });
        }
        // Content after </last_message> (e.g. <output_format>)
        if (afterClose) {
          const post = parseXmlSections(afterClose, msg.role);
          for (const b of post) result.push(b);
        }
      } else {
        // Markdown format or no tags — strip heading and show as-is
        const content = msg.content.replace(/^## Last Message\n?/i, "");
        result.push({
          kind: "section",
          label: "last_message",
          role: msg.role,
          content: content.trim(),
        });
      }
      continue;
    }

    // ── System/other messages: parse XML sections within them ──
    appendPromptSections(result, msg);
  }

  return result;
}

// ═══════════════════════════════════════════════
//  UI Components
// ═══════════════════════════════════════════════

function CollapsibleBlock({
  label,
  content,
  defaultOpen,
  roleColor,
}: {
  label: string;
  content: string;
  defaultOpen: boolean;
  roleColor: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tokens = estimateTokens(content);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        {open ? (
          <ChevronDown size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span className={cn("rounded-md px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider", roleColor)}>
          {prettifyTag(label)}
        </span>
        <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">
          ~{fmtTokens(tokens)} token{tokens !== 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/50 px-3 py-2">
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--foreground)]/80">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

function ChatHistorySection({ entries, rawContent }: { entries: ChatHistoryEntry[]; rawContent: string }) {
  const [open, setOpen] = useState(false);
  const tokens = estimateTokens(rawContent);

  const msgRoleColor = (role: string) => {
    if (role === "user") return "bg-blue-500/20 text-blue-400";
    if (role === "assistant") return "bg-purple-500/20 text-purple-400";
    return "bg-amber-500/20 text-amber-400";
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        {open ? (
          <ChevronDown size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider",
            "bg-green-500/20 text-green-400",
          )}
        >
          Chat History
        </span>
        <span className="text-[0.625rem] text-[var(--muted-foreground)]">
          {entries.length} message{entries.length !== 1 ? "s" : ""}
        </span>
        <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">
          ~{fmtTokens(tokens)} token{tokens !== 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/50 p-2 space-y-1">
          {entries.map((entry, i) => (
            <ChatHistoryMessage key={i} entry={entry} roleColor={msgRoleColor(entry.role)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatHistoryMessage({ entry, roleColor }: { entry: ChatHistoryEntry; roleColor: string }) {
  const [open, setOpen] = useState(false);
  const tokens = estimateTokens(entry.content);
  const preview = entry.content.split("\n")[0]?.slice(0, 80) ?? "";

  return (
    <div className="rounded-md border border-[var(--border)]/30 bg-[var(--background)]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--accent)]/30"
      >
        {open ? (
          <ChevronDown size="0.625rem" className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight size="0.625rem" className="shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span className={cn("rounded px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider", roleColor)}>
          {entry.role}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[0.625rem] text-[var(--muted-foreground)]">{preview}</span>
        )}
        <span className="shrink-0 ml-auto text-[0.5625rem] text-[var(--muted-foreground)]">~{fmtTokens(tokens)}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/30 px-2.5 py-1.5">
          <pre className="whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed text-[var(--foreground)]/80">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Main Modal
// ═══════════════════════════════════════════════

function budgetPercent(budget: PromptBudgetEstimate): number | null {
  if (!budget.contextLimit || budget.contextLimit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((budget.estimatedPromptTokens / budget.contextLimit) * 100)));
}

function budgetToneClass(budget: PromptBudgetEstimate): string {
  if (budget.remainingTokens != null && budget.remainingTokens < 0) return "text-red-300";
  if (budget.warnings.some((warning) => warning.kind === "near_limit" || warning.kind === "large_section")) {
    return "text-amber-300";
  }
  return "text-emerald-300";
}

function budgetFillClass(budget: PromptBudgetEstimate): string {
  if (budget.remainingTokens != null && budget.remainingTokens < 0) return "bg-red-400";
  if (budget.warnings.some((warning) => warning.kind === "near_limit" || warning.kind === "large_section")) {
    return "bg-amber-300";
  }
  return "bg-emerald-300";
}

function trimRiskLabel(risk: string): string | null {
  if (risk === "high") return "trim risk";
  if (risk === "medium") return "watch";
  return null;
}

function BudgetOverview({ budget }: { budget: PromptBudgetEstimate }) {
  const percent = budgetPercent(budget);
  const sectionTotal = Math.max(1, budget.estimatedPromptTokens);
  const remainingLabel =
    budget.remainingTokens == null
      ? "unknown remaining"
      : budget.remainingTokens < 0
        ? `${fmtTokens(Math.abs(budget.remainingTokens))} over`
        : `${fmtTokens(budget.remainingTokens)} left`;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
          <Gauge size="0.875rem" />
          Prompt Budget
        </span>
        <span className={cn("text-[0.6875rem] font-medium", budgetToneClass(budget))}>{remainingLabel}</span>
        <span className="text-[0.6875rem] text-[var(--muted-foreground)]">
          ~{fmtTokens(budget.estimatedPromptTokens)} prompt tokens
          {budget.contextLimit != null ? <> / {fmtTokens(budget.contextLimit)} context</> : <> / unknown context</>}
        </span>
      </div>

      {percent != null && (
        <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]/50">
          <div
            className={cn("h-full rounded-full transition-all", budgetFillClass(budget))}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="grid gap-2 text-[0.6875rem] sm:grid-cols-3">
        <div className="rounded-md bg-[var(--background)]/45 px-3 py-2">
          <div className="text-[var(--muted-foreground)]">Input budget</div>
          <div className="font-semibold text-[var(--foreground)]">
            {budget.inputBudgetTokens == null ? "Unknown" : fmtTokens(budget.inputBudgetTokens)}
          </div>
        </div>
        <div className="rounded-md bg-[var(--background)]/45 px-3 py-2">
          <div className="text-[var(--muted-foreground)]">Output reserve</div>
          <div className="font-semibold text-[var(--foreground)]">
            {budget.outputReserveTokens == null ? "Unknown" : fmtTokens(budget.outputReserveTokens)}
          </div>
        </div>
        <div className="rounded-md bg-[var(--background)]/45 px-3 py-2">
          <div className="text-[var(--muted-foreground)]">Safety reserve</div>
          <div className="font-semibold text-[var(--foreground)]">
            {budget.safetyReserveTokens == null ? "Unknown" : fmtTokens(budget.safetyReserveTokens)}
          </div>
        </div>
      </div>

      {budget.warnings.length > 0 && (
        <div className="space-y-1.5">
          {budget.warnings.slice(0, 4).map((warning, index) => (
            <div
              key={`${warning.kind}-${index}`}
              className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[0.6875rem] text-amber-200/90"
            >
              <AlertTriangle size="0.75rem" className="mt-0.5 shrink-0" />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {budget.sections.map((section) => {
          const share = Math.max(2, Math.min(100, Math.round((section.estimatedTokens / sectionTotal) * 100)));
          const risk = trimRiskLabel(section.trimRisk);
          return (
            <div key={section.kind} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[0.6875rem]">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-[var(--foreground)]">{section.label}</span>
                  {risk && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.5625rem] text-amber-200">
                      {risk}
                    </span>
                  )}
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--muted)]/45">
                  <div className="h-full rounded-full bg-[var(--foreground)]/45" style={{ width: `${share}%` }} />
                </div>
              </div>
              <span className="text-[var(--muted-foreground)]">~{fmtTokens(section.estimatedTokens)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function attributionBadgeClass(model: PromptAttributionViewModel): string {
  if (model.sourceTone === "exact") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function AttributionPanel({ model }: { model: PromptAttributionViewModel }) {
  const itemCount = model.groups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.6875rem] font-bold uppercase text-[var(--foreground)]">Context Attribution</span>
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-[0.5625rem] font-bold uppercase",
            attributionBadgeClass(model),
          )}
        >
          {model.sourceLabel}
        </span>
        <span className="text-[0.625rem] text-[var(--muted-foreground)]">
          {itemCount} source{itemCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {model.groups.map((group) => (
          <div
            key={group.label}
            className="rounded-md border border-[var(--border)]/50 bg-[var(--background)]/35 px-3 py-2"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[0.625rem] font-bold uppercase text-[var(--muted-foreground)]">{group.label}</span>
              <span className="text-[0.5625rem] text-[var(--muted-foreground)]">{group.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {group.items.map((item, index) => (
                <div key={`${item.label}-${index}`} className="grid gap-1 text-[0.6875rem]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--foreground)]">{item.label}</span>
                    <span className="rounded bg-[var(--accent)]/60 px-1.5 py-0.5 text-[0.5625rem] uppercase text-[var(--muted-foreground)]">
                      {item.statusLabel}
                    </span>
                  </div>
                  {item.snippet ? (
                    <p className="max-h-10 overflow-hidden text-[0.6875rem] leading-relaxed text-[var(--foreground)]/75">
                      {item.snippet}
                    </p>
                  ) : (
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">Hidden source details redacted.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PeekPromptModal({ data, onClose }: PeekPromptModalProps) {
  const { data: presetSummaries } = usePresetSummaries();
  const displayMessages = data.previewMessages?.length ? data.previewMessages : data.messages;
  const sections = useMemo(() => buildDisplaySections(displayMessages), [displayMessages]);
  const totalTokens = useMemo(
    () => data.budget?.estimatedPromptTokens ?? estimateTokens(data.messages.map((m) => m.content).join("")),
    [data.budget?.estimatedPromptTokens, data.messages],
  );
  const isLoading = data.loading === true;
  const budget = data.budget;
  const attributionModel = useMemo(
    () => buildPromptAttributionViewModel(data.contextAttribution),
    [data.contextAttribution],
  );

  const gen = data.generationInfo;
  const params = data.parameters as Record<string, unknown> | null;
  const promptPresetLabel = useMemo(() => {
    const id = data.promptPresetId?.trim();
    if (!id) return null;
    return presetSummaries?.find((preset) => preset.id === id)?.name?.trim() || id;
  }, [data.promptPresetId, presetSummaries]);

  // Build parameter pills from generationInfo (cached) or assembled parameters
  const paramPills = useMemo(() => {
    const pills: Array<{ label: string; value: string }> = [];
    if (gen) {
      if (gen.temperature != null) pills.push({ label: "Temperature", value: String(gen.temperature) });
      if (gen.maxTokens != null) pills.push({ label: "Max Output Tokens", value: fmtTokens(gen.maxTokens) });
      if (gen.topP != null && gen.topP !== 1) pills.push({ label: "Top P", value: String(gen.topP) });
      if (gen.topK != null && gen.topK !== 0) pills.push({ label: "Top K", value: String(gen.topK) });
      if (gen.frequencyPenalty != null && gen.frequencyPenalty !== 0)
        pills.push({ label: "Freq Penalty", value: String(gen.frequencyPenalty) });
      if (gen.presencePenalty != null && gen.presencePenalty !== 0)
        pills.push({ label: "Pres Penalty", value: String(gen.presencePenalty) });
      if (gen.showThoughts) pills.push({ label: "Thinking", value: "On" });
      if (gen.reasoningEffort) pills.push({ label: "Reasoning", value: gen.reasoningEffort });
      if (gen.verbosity) pills.push({ label: "Verbosity", value: gen.verbosity });
      if (gen.serviceTier) pills.push({ label: "Service Tier", value: gen.serviceTier });
      if (gen.assistantPrefill) pills.push({ label: "Assistant Prefill", value: "On" });
    } else if (params) {
      if (params.temperature != null) pills.push({ label: "Temperature", value: String(params.temperature) });
      if (params.topP != null && params.topP !== 1) pills.push({ label: "Top P", value: String(params.topP) });
      if (params.topK != null && params.topK !== 0) pills.push({ label: "Top K", value: String(params.topK) });
      if (params.minP != null && params.minP !== 0) pills.push({ label: "Min P", value: String(params.minP) });
      if (params.maxTokens != null)
        pills.push({ label: "Max Output Tokens", value: fmtTokens(params.maxTokens as number) });
      if (params.frequencyPenalty != null && params.frequencyPenalty !== 0)
        pills.push({ label: "Freq Penalty", value: String(params.frequencyPenalty) });
      if (params.presencePenalty != null && params.presencePenalty !== 0)
        pills.push({ label: "Pres Penalty", value: String(params.presencePenalty) });
      if (params.showThoughts) pills.push({ label: "Thinking", value: "On" });
      if (params.reasoningEffort) pills.push({ label: "Reasoning", value: String(params.reasoningEffort) });
      if (params.verbosity) pills.push({ label: "Verbosity", value: String(params.verbosity) });
      if (params.serviceTier) pills.push({ label: "Service Tier", value: String(params.serviceTier) });
      if (params.assistantPrefill) pills.push({ label: "Assistant Prefill", value: "On" });
    }
    return pills;
  }, [gen, params]);

  const sectionRoleColor = (role: string, label: string) => {
    if (/last.?message/i.test(label)) return "bg-blue-500/20 text-blue-400";
    if (role === "system") return "bg-amber-500/20 text-amber-400";
    if (role === "user") return "bg-blue-500/20 text-blue-400";
    return "bg-purple-500/20 text-purple-400";
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="shrink-0 text-sm font-bold">Assembled Prompt</h3>
            {!isLoading && !data.error && (
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-[0.5625rem] font-bold uppercase",
                  sourceBadgeClass(data),
                )}
              >
                {sourceLabel(data)}
              </span>
            )}
            <span className="text-[0.625rem] text-[var(--muted-foreground)]">
              {isLoading
                ? "assembling"
                : `${sections.length} section${sections.length !== 1 ? "s" : ""} \u00b7 ~${fmtTokens(totalTokens)} tokens`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading && (
            <div className="flex min-h-48 items-center justify-center text-[var(--muted-foreground)]">
              <Loader2 size="1.5rem" className="animate-spin" />
            </div>
          )}
          {!isLoading && data.error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[0.75rem] text-red-300/90">
              {data.error}
            </div>
          )}
          {!isLoading && !data.error && budget && <BudgetOverview budget={budget} />}
          {!isLoading && !data.error && (gen || paramPills.length > 0) && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem]">
                {gen?.model && (
                  <span className="font-medium text-[var(--foreground)]">
                    {gen.provider ? (
                      <span className="text-[var(--muted-foreground)] font-normal">{gen.provider} / </span>
                    ) : null}
                    {gen.model}
                  </span>
                )}
                {promptPresetLabel && (
                  <span className="font-medium text-[var(--foreground)]" title={data.promptPresetId ?? undefined}>
                    <span className="text-[var(--muted-foreground)] font-normal">Preset / </span>
                    {promptPresetLabel}
                  </span>
                )}
                <span className="text-[var(--muted-foreground)]">
                  ~{fmtTokens(totalTokens)} est. tokens
                  {gen?.tokensPrompt != null && <> | {fmtTokens(gen.tokensPrompt)} actual prompt tokens</>}
                  {(gen?.tokensCachedPrompt ?? 0) > 0 && <> | {fmtTokens(gen?.tokensCachedPrompt ?? 0)} cached</>}
                  {(gen?.tokensCacheWritePrompt ?? 0) > 0 && (
                    <> | {fmtTokens(gen?.tokensCacheWritePrompt ?? 0)} cache write</>
                  )}
                </span>
              </div>
              {paramPills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {paramPills.map((p) => (
                    <span
                      key={p.label}
                      className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/50 px-2 py-0.5 text-[0.625rem]"
                    >
                      <span className="text-[var(--muted-foreground)]">{p.label}</span>
                      <span className="font-medium text-[var(--foreground)]">{p.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {!isLoading && !data.error && attributionModel && <AttributionPanel model={attributionModel} />}
          {!isLoading && !data.error && data.agentNote && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[0.6875rem] text-amber-300/80">
              Note: {data.agentNote}
            </div>
          )}
          {!isLoading &&
            !data.error &&
            sections.map((s, i) =>
              s.kind === "chat-history" ? (
                <ChatHistorySection key={i} entries={s.entries} rawContent={s.rawContent} />
              ) : (
                <CollapsibleBlock
                  key={i}
                  label={s.label}
                  content={s.content}
                  defaultOpen={false}
                  roleColor={sectionRoleColor(s.role, s.label)}
                />
              ),
            )}
        </div>
      </div>
    </div>
  );
}
