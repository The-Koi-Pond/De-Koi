import type { LlmMessage } from "../capabilities/llm";
import { effectiveMaxContext, estimateLlmMessageTokens } from "./context-window";
import { readNumber, readString } from "./runtime-records";

const DEFAULT_RESPONSE_TOKENS = 4096;
const CONTEXT_SAFETY_TOKENS = 256;
const LARGE_SECTION_TOKENS = 1000;

type PromptBudgetSectionKind =
  | "preset"
  | "character"
  | "persona"
  | "lorebook"
  | "memory"
  | "history"
  | "attachment"
  | "injection"
  | "game"
  | "other";

type PromptBudgetTrimRisk = "none" | "medium" | "high";

type PromptBudgetWarningKind =
  | "unknown_limit"
  | "near_limit"
  | "over_budget"
  | "large_section"
  | "lorebook_skipped"
  | "history_trim"
  | "context_overlap";

interface PromptBudgetSection {
  kind: PromptBudgetSectionKind;
  label: string;
  estimatedTokens: number;
  messageCount: number;
  trimRisk: PromptBudgetTrimRisk;
}

interface PromptBudgetWarning {
  kind: PromptBudgetWarningKind;
  message: string;
  sectionKind?: PromptBudgetSectionKind;
  sectionLabel?: string;
  tokens?: number;
  phrase?: string;
  sources?: string[];
}

export interface PromptBudgetEstimate {
  contextLimit: number | null;
  estimatedPromptTokens: number;
  outputReserveTokens: number | null;
  safetyReserveTokens: number | null;
  inputBudgetTokens: number | null;
  remainingTokens: number | null;
  sections: PromptBudgetSection[];
  warnings: PromptBudgetWarning[];
}

interface PromptBudgetMessage extends LlmMessage {
  contextKind?: unknown;
  displayName?: unknown;
}

interface PromptBudgetInput {
  messages: LlmMessage[];
  connection?: Record<string, unknown> | null;
  parameters?: Record<string, unknown> | null;
  budgetSkippedLorebookEntries?: Array<{ name?: unknown; id?: unknown; lorebookId?: unknown }> | null;
}

function normalizedLabel(message: PromptBudgetMessage): string {
  return readString(message.displayName || message.name).trim();
}

function normalizedSearchText(message: PromptBudgetMessage): string {
  return `${normalizedLabel(message)}\n${message.content ?? ""}`.toLowerCase();
}

function classifyPromptMessage(message: PromptBudgetMessage): PromptBudgetSectionKind {
  const contextKind = readString(message.contextKind).trim();
  const text = normalizedSearchText(message);
  if (contextKind === "history") return "history";
  if (message.images?.length) return "attachment";
  if (contextKind === "injection") return "injection";
  if (/\b(lorebook|world info|world_info|world facts?)\b/.test(text)) return "lorebook";
  if (/\b(character|char card|character info|character_info)\b/.test(text)) return "character";
  if (/\b(persona|user profile)\b/.test(text)) return "persona";
  if (/\b(summary|memory|notes?|recall)\b/.test(text)) return "memory";
  if (/\b(game|gm|quest|party|morale|hud|tracker|map)\b/.test(text)) return "game";
  if (contextKind === "prompt" || message.role === "system") return "preset";
  return "other";
}

function sectionLabel(kind: PromptBudgetSectionKind): string {
  switch (kind) {
    case "preset":
      return "System and Preset";
    case "character":
      return "Character Context";
    case "persona":
      return "Persona Context";
    case "lorebook":
      return "Lorebook";
    case "memory":
      return "Summary and Memory";
    case "history":
      return "Recent Chat History";
    case "attachment":
      return "Attachments";
    case "injection":
      return "Injected Context";
    case "game":
      return "Game Context";
    default:
      return "Other Context";
  }
}

function outputReserve(parameters: Record<string, unknown> | null | undefined): number {
  return Math.max(1, readNumber(parameters?.maxTokens, DEFAULT_RESPONSE_TOKENS));
}

function sectionTrimRisk(
  section: PromptBudgetSection,
  inputBudgetTokens: number | null,
  remainingTokens: number | null,
): PromptBudgetTrimRisk {
  if (section.kind !== "history" && section.kind !== "lorebook") return "none";
  if (remainingTokens != null && remainingTokens < 0) return "high";
  if (inputBudgetTokens != null && inputBudgetTokens > 0 && section.estimatedTokens > inputBudgetTokens * 0.35) {
    return "medium";
  }
  return "none";
}

function buildSections(
  messages: LlmMessage[],
  inputBudgetTokens: number | null,
  remainingTokens: number | null,
): PromptBudgetSection[] {
  const byKind = new Map<PromptBudgetSectionKind, PromptBudgetSection>();
  for (const rawMessage of messages) {
    const message = rawMessage as PromptBudgetMessage;
    const kind = classifyPromptMessage(message);
    const estimatedTokens = estimateLlmMessageTokens(rawMessage);
    const existing = byKind.get(kind);
    if (existing) {
      existing.estimatedTokens += estimatedTokens;
      existing.messageCount += 1;
    } else {
      byKind.set(kind, {
        kind,
        label: sectionLabel(kind),
        estimatedTokens,
        messageCount: 1,
        trimRisk: "none",
      });
    }
  }
  const sections = [...byKind.values()];
  for (const section of sections) {
    section.trimRisk = sectionTrimRisk(section, inputBudgetTokens, remainingTokens);
  }
  return sections;
}

function skippedLorebookName(entry: { name?: unknown; id?: unknown; lorebookId?: unknown }): string {
  return readString(entry.name).trim() || readString(entry.id).trim() || readString(entry.lorebookId).trim() || "entry";
}

function formatBudgetTokens(tokens: number): string {
  return Math.max(0, Math.round(tokens)).toLocaleString("en-US");
}

interface PromptOverlapSource {
  label: string;
  kind: PromptBudgetSectionKind;
  text: string;
}

const MAX_CONTEXT_OVERLAP_WARNINGS = 3;
const OVERLAP_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "their",
  "there",
  "these",
  "those",
  "through",
  "under",
  "where",
  "which",
  "while",
  "would",
  "should",
  "could",
  "character",
  "persona",
  "summary",
  "memory",
  "memories",
  "profile",
  "appearance",
  "description",
  "known",
  "wants",
  "user",
]);

function overlapLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "context";
}

function overlapSourceKind(label: string, fallbackMessage: PromptBudgetMessage): PromptBudgetSectionKind {
  const normalized = overlapLabel(label);
  if (/\b(public_profile|appearance|personality|character|character_info|backstory|scenario|example)\b/.test(normalized)) {
    return "character";
  }
  if (/\b(persona|user_profile)\b/.test(normalized)) return "persona";
  if (/\b(memory|memories|summary|chat_summary|recall|notes)\b/.test(normalized)) return "memory";
  if (/\b(lorebook|world_info|world_facts)\b/.test(normalized)) return "lorebook";
  return classifyPromptMessage(fallbackMessage);
}

function isStandaloneXmlTag(line: string): RegExpMatchArray | null {
  return line.match(/^<\/?([a-zA-Z][\w:-]*)\s*>$/);
}

function promptOverlapSources(messages: LlmMessage[]): PromptOverlapSource[] {
  const sources: PromptOverlapSource[] = [];
  for (const rawMessage of messages) {
    const message = rawMessage as PromptBudgetMessage;
    const fallbackLabel = overlapLabel(normalizedLabel(message) || classifyPromptMessage(message));
    const stack: string[] = [];
    const sourceText = new Map<string, string[]>();

    for (const line of (message.content ?? "").split(/\r?\n/)) {
      const trimmed = line.trim();
      const tagMatch = isStandaloneXmlTag(trimmed);
      if (tagMatch) {
        if (trimmed.startsWith("</")) {
          stack.pop();
        } else {
          stack.push(overlapLabel(tagMatch[1] ?? ""));
        }
        continue;
      }

      const label = stack.length > 0 ? stack[stack.length - 1]! : fallbackLabel;
      const existing = sourceText.get(label) ?? [];
      existing.push(line);
      sourceText.set(label, existing);
    }

    for (const [label, lines] of sourceText) {
      const sourceTextValue = lines.join("\n").trim();
      if (sourceTextValue.length >= 24) {
        sources.push({
          label,
          kind: overlapSourceKind(label, message),
          text: sourceTextValue,
        });
      }
    }
  }
  return sources;
}

function overlapTokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .match(/[a-z0-9]+/g) ?? []
  );
}

function isSignificantOverlapPhrase(phrase: string): boolean {
  const words = phrase.split(" ");
  const significantWords = words.filter((word) => word.length >= 4 && !OVERLAP_STOP_WORDS.has(word));
  return significantWords.length >= 3;
}

function overlapPhraseCandidates(text: string): string[] {
  const tokens = overlapTokens(text);
  const phrases = new Set<string>();
  for (const length of [3, 4, 5]) {
    for (let index = 0; index <= tokens.length - length; index += 1) {
      const phrase = tokens.slice(index, index + length).join(" ");
      if (isSignificantOverlapPhrase(phrase)) {
        phrases.add(phrase);
      }
    }
  }
  return [...phrases];
}

function overlapWarningSectionKind(sources: PromptOverlapSource[]): PromptBudgetSectionKind {
  if (sources.some((source) => source.kind === "character")) return "character";
  if (sources.some((source) => source.kind === "persona")) return "persona";
  if (sources.some((source) => source.kind === "memory")) return "memory";
  return sources[0]?.kind ?? "other";
}
function displayOverlapSourceLabel(label: string): string {
  return label
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildContextOverlapWarnings(messages: LlmMessage[]): PromptBudgetWarning[] {
  const phraseSources = new Map<string, PromptOverlapSource[]>();
  for (const source of promptOverlapSources(messages)) {
    for (const phrase of overlapPhraseCandidates(source.text)) {
      const existing = phraseSources.get(phrase) ?? [];
      if (!existing.some((existingSource) => existingSource.label === source.label)) {
        existing.push(source);
      }
      phraseSources.set(phrase, existing);
    }
  }

  return [...phraseSources]
    .filter(([, sources]) => sources.length >= 2)
    .sort(([phraseA, sourcesA], [phraseB, sourcesB]) => sourcesB.length - sourcesA.length || phraseB.length - phraseA.length)
    .slice(0, MAX_CONTEXT_OVERLAP_WARNINGS)
    .map(([phrase, sources]) => {
      const sectionKind = overlapWarningSectionKind(sources);
      const labels = sources.map((source) => source.label);
      return {
        kind: "context_overlap",
        sectionKind,
        sectionLabel: sectionLabel(sectionKind),
        phrase,
        sources: labels,
        message: `Repeated cue "${phrase}" appears in ${labels.map(displayOverlapSourceLabel).join(", ")}. Consider keeping this detail in one canonical context source.`,
      };
    });
}

export function buildPromptBudgetEstimate(input: PromptBudgetInput): PromptBudgetEstimate {
  const parameters = input.parameters ?? {};
  const contextLimit = effectiveMaxContext(input.connection, parameters) || null;
  const estimatedPromptTokens = input.messages.reduce((total, message) => total + estimateLlmMessageTokens(message), 0);
  const outputReserveTokens = contextLimit == null ? null : outputReserve(parameters);
  const safetyReserveTokens = contextLimit == null ? null : CONTEXT_SAFETY_TOKENS;
  const inputBudgetTokens =
    contextLimit == null || outputReserveTokens == null
      ? null
      : Math.max(0, contextLimit - outputReserveTokens - CONTEXT_SAFETY_TOKENS);
  const remainingTokens = inputBudgetTokens == null ? null : inputBudgetTokens - estimatedPromptTokens;
  const sections = buildSections(input.messages, inputBudgetTokens, remainingTokens);
  const warnings: PromptBudgetWarning[] = [];

  if (contextLimit == null) {
    warnings.push({
      kind: "unknown_limit",
      message: "Context limit is unknown for this connection, so remaining tokens can only be estimated.",
    });
  } else if ((remainingTokens ?? 0) < 0) {
    const overageTokens = Math.abs(remainingTokens ?? 0);
    warnings.push({
      kind: "over_budget",
      message: `This prompt is larger than the estimated input budget by about ${formatBudgetTokens(
        overageTokens,
      )} tokens. Aim for about ${formatBudgetTokens(inputBudgetTokens ?? 0)} input tokens or less.`,
      tokens: overageTokens,
    });
  } else if (inputBudgetTokens && remainingTokens != null && remainingTokens <= inputBudgetTokens * 0.1) {
    warnings.push({
      kind: "near_limit",
      message: `This prompt is close to the estimated context limit. Aim to stay under about ${formatBudgetTokens(
        inputBudgetTokens,
      )} input tokens; about ${formatBudgetTokens(remainingTokens)} remain.`,
      tokens: remainingTokens,
    });
  }

  const historySection = sections.find((section) => section.kind === "history");
  if (historySection?.trimRisk === "high") {
    warnings.push({
      kind: "history_trim",
      sectionKind: "history",
      sectionLabel: historySection.label,
      message: "Recent chat history is the most likely section to be trimmed.",
      tokens: historySection.estimatedTokens,
    });
  }

  for (const section of sections) {
    const threshold =
      inputBudgetTokens && inputBudgetTokens > 0
        ? Math.min(LARGE_SECTION_TOKENS, Math.max(400, Math.floor(inputBudgetTokens * 0.25)))
        : LARGE_SECTION_TOKENS;
    if (section.estimatedTokens >= threshold) {
      warnings.push({
        kind: "large_section",
        sectionKind: section.kind,
        sectionLabel: section.label,
        message: `${section.label} is unusually large for this prompt. Try to keep it under about ${formatBudgetTokens(
          threshold,
        )} tokens.`,
        tokens: section.estimatedTokens,
      });
    }
  }

  warnings.push(...buildContextOverlapWarnings(input.messages));

  const skippedLorebookEntries = input.budgetSkippedLorebookEntries ?? [];
  if (skippedLorebookEntries.length > 0) {
    const first = skippedLorebookName(skippedLorebookEntries[0]!);
    warnings.push({
      kind: "lorebook_skipped",
      sectionKind: "lorebook",
      sectionLabel: sectionLabel("lorebook"),
      message:
        skippedLorebookEntries.length === 1
          ? `Lorebook entry "${first}" was skipped by lorebook budget rules.`
          : `${skippedLorebookEntries.length} lorebook entries were skipped by lorebook budget rules.`,
    });
  }

  return {
    contextLimit,
    estimatedPromptTokens,
    outputReserveTokens,
    safetyReserveTokens,
    inputBudgetTokens,
    remainingTokens,
    sections,
    warnings,
  };
}
