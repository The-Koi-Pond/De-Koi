// The agent editor's form: what it shows for a stored row, a built-in without a row or a new custom agent,
// how typed numbers are read, and the payload Save hands the agents hooks (docs/provenance/agent-editor.md,
// "Loading the form" and "Save"). The payload is a compatibility contract: every agent run reads it.
import {
  normalizeCustomAgentActivationKeywords,
  normalizeCustomAgentActivationScanDepth,
} from "../../../../../engine/contracts/constants/agent-activation";
import {
  DEFAULT_AGENT_MAX_TOKENS,
  DEFAULT_AGENT_TOOLS,
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
  getDefaultBuiltInAgentSettings,
  type AgentPhase,
  type BuiltInAgentMeta,
} from "../../../../../engine/contracts/types/agent";
import {
  illustratorAvatarReferenceMode,
  serializeIllustratorAvatarReferenceSettings,
  type IllustratorAvatarReferenceMode,
} from "../../../../../engine/generation/illustrator-settings";
import { agentCreditLabel, agentEnabledFlag, type AgentConfigRow } from "../../hooks/use-agents";
import {
  normalizeAgentLorebookWriterEditorState,
  type AgentLorebookWriterSaveState,
} from "../../lib/agent-lorebook-writer-settings";

export const NEW_AGENT_ID = "__new__";

export type CustomResultType = "context_injection" | "text_rewrite";

/**
 * A number box's value: empty, a number, or a stored value of another type shown as stored (a string
 * context size, say).
 */
export type NumberValue = number | "" | string;

export interface AgentForm {
  name: string;
  /** Missing on some stored rows; saved as it is. */
  description: string | undefined;
  /** The row's `credit` as stored (a number shows as typed text and saves as ""). */
  author: unknown;
  enabled: boolean;
  /** As stored; only the three `AgentPhase` values render. */
  phase: string;
  connectionId: string;
  contextSize: NumberValue;
  maxTokens: NumberValue;
  imageConnectionId: string;
  runInterval: NumberValue;
  activationKeywords: string;
  activationScanDepth: number | "";
  injectAsSection: boolean;
  enabledTools: string[];
  lorebookWriteEnabled: boolean;
  writableLorebookId: string;
  sourceLorebookIds: string[];
  useChatActiveLorebooks: boolean;
  sourceFileIds: string[];
  autoGenerateAvatars: boolean;
  autoGenerateBackgrounds: boolean;
  avatarReferenceMode: IllustratorAvatarReferenceMode;
  imagePositivePrompt: string;
  imageNegativePrompt: string;
  resultType: CustomResultType;
  includePreGenInjections: boolean;
  includeParallelResults: boolean;
  promptTemplate: string;
}

type Settings = Record<string, unknown>;

/** A string is parsed as JSON (a bad string throws), an object is used as is, anything falsy is `{}`. */
function parseStoredSettings(value: unknown): Settings {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value) as Settings;
  return value as Settings;
}

/** `null` and missing fall through; anything else is kept as stored. */
function stored<T>(value: unknown, fallback: T): T {
  return value === null || value === undefined ? fallback : (value as T);
}

/** `true`/`false`, or the usual on/off strings in any case; anything else is `fallback`. */
function storedFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(text)) return true;
    if (["false", "0", "no", "off"].includes(text)) return false;
  }
  return fallback;
}

/** The form for a stored row (built-in or custom). */
export function formFromRow(row: AgentConfigRow, builtIn: BuiltInAgentMeta | undefined, defaultsType: string) {
  const settings = parseStoredSettings(row.settings);
  const defaults = getDefaultBuiltInAgentSettings(defaultsType);
  const writer = normalizeAgentLorebookWriterEditorState(settings, DEFAULT_AGENT_TOOLS[row.type] ?? []);
  const form: AgentForm = {
    name: builtIn ? builtIn.name : row.name,
    description: row.description,
    author: stored(row.credit, stored(builtIn?.credit, "")),
    enabled: agentEnabledFlag(row.enabled, true),
    phase: row.phase,
    connectionId: stored(row.connectionId, ""),
    contextSize: stored(settings.contextSize, ""),
    maxTokens: stored(settings.maxTokens, stored(defaults.maxTokens, "")),
    imageConnectionId: stored(settings.imageConnectionId, ""),
    runInterval: stored(settings.runInterval, stored(defaults.runInterval, "")),
    activationKeywords: normalizeCustomAgentActivationKeywords(settings.activationKeywords).join("\n"),
    activationScanDepth: normalizeCustomAgentActivationScanDepth(settings.activationScanDepth),
    injectAsSection: stored(settings.injectAsSection, defaults.injectAsSection === true),
    enabledTools: writer.enabledTools,
    lorebookWriteEnabled: writer.lorebookWriteEnabled,
    writableLorebookId: writer.writableLorebookId,
    sourceLorebookIds: stored(settings.sourceLorebookIds, []),
    useChatActiveLorebooks: storedFlag(settings.useChatActiveLorebooks, defaults.useChatActiveLorebooks === true),
    sourceFileIds: stored(settings.sourceFileIds, []),
    autoGenerateAvatars: stored(settings.autoGenerateAvatars, false),
    autoGenerateBackgrounds: stored(settings.autoGenerateBackgrounds, false),
    avatarReferenceMode: illustratorAvatarReferenceMode(settings),
    imagePositivePrompt: stored(settings.imagePositivePrompt, ""),
    imageNegativePrompt: stored(settings.imageNegativePrompt, ""),
    resultType: settings.resultType === "text_rewrite" ? "text_rewrite" : "context_injection",
    includePreGenInjections: settings.includePreGenInjections === true,
    includeParallelResults: settings.includeParallelResults === true,
    promptTemplate: row.promptTemplate || "",
  };
  return form;
}

/** The form for a built-in agent that has no stored row yet: its defaults. */
export function formFromBuiltIn(builtIn: BuiltInAgentMeta): AgentForm {
  const defaults = getDefaultBuiltInAgentSettings(builtIn.id);
  return {
    ...emptyForm(),
    name: builtIn.name,
    description: builtIn.description,
    author: builtIn.credit,
    enabled: builtIn.enabledByDefault,
    phase: builtIn.phase,
    maxTokens: stored(defaults.maxTokens, ""),
    runInterval: stored(defaults.runInterval, ""),
    injectAsSection: defaults.injectAsSection === true,
    enabledTools: [...(DEFAULT_AGENT_TOOLS[builtIn.id] ?? [])],
    useChatActiveLorebooks: defaults.useChatActiveLorebooks === true,
    avatarReferenceMode: illustratorAvatarReferenceMode(defaults),
  };
}

/** The form for a new custom agent. */
export function formForNewAgent(cadenceDefault: number | undefined): AgentForm {
  return { ...emptyForm(), name: "New Agent", runInterval: cadenceDefault ?? "" };
}

function emptyForm(): AgentForm {
  return {
    name: "",
    description: "",
    author: "",
    enabled: true,
    phase: "post_processing",
    connectionId: "",
    contextSize: "",
    maxTokens: DEFAULT_AGENT_MAX_TOKENS,
    imageConnectionId: "",
    runInterval: "",
    activationKeywords: "",
    activationScanDepth: normalizeCustomAgentActivationScanDepth(undefined),
    injectAsSection: false,
    enabledTools: [],
    lorebookWriteEnabled: false,
    writableLorebookId: "",
    sourceLorebookIds: [],
    useChatActiveLorebooks: false,
    sourceFileIds: [],
    autoGenerateAvatars: false,
    autoGenerateBackgrounds: false,
    avatarReferenceMode: "inherit",
    imagePositivePrompt: "",
    imageNegativePrompt: "",
    resultType: "context_injection",
    includePreGenInjections: false,
    includeParallelResults: false,
    promptTemplate: "",
  };
}

// ── Number boxes ──────────────────────────────────────────────────────────────

/** Context size, Triggers After, Run Interval, built-in cadence, scan depth: empty, or clamped (unreadable → 1). */
export function readClampedCount(text: string, max: number): number | "" {
  if (text === "") return "";
  const parsed = parseInt(text, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : 1;
}

/** Max output tokens while typing: empty when empty or unreadable, else clamped to 1..the maximum. */
export function readMaxTokens(text: string): number | "" {
  const parsed = parseInt(text, 10);
  if (text === "" || !Number.isFinite(parsed)) return "";
  return Math.max(1, Math.min(MAX_AGENT_MAX_TOKENS, parsed));
}

/** Max output tokens when the box is left: a non-empty value clamped to the allowed range and truncated. */
export function clampMaxTokens(value: NumberValue): NumberValue {
  if (value === "") return value;
  return Math.trunc(Math.max(MIN_AGENT_MAX_TOKENS, Math.min(MAX_AGENT_MAX_TOKENS, Number(value))));
}

// ── Save ──────────────────────────────────────────────────────────────────────

/** Who the form belongs to, as far as Save cares. */
export interface SaveTarget {
  /** A custom agent, stored or new (also a built-in opened by its row id). */
  custom: boolean;
  /** `agentDetailId` or the stored row's type, for the type-specific settings. */
  isType: (type: string) => boolean;
}

/** Text Rewrite agents always save as Post-Processing. */
export function savedPhase(form: AgentForm, custom: boolean): string {
  return custom && form.resultType === "text_rewrite" ? "post_processing" : form.phase;
}

/** The payload Save hands the hooks, keys in the stored contract's order. */
export function agentSavePayload(form: AgentForm, target: SaveTarget, writer: AgentLorebookWriterSaveState) {
  const { custom, isType } = target;
  const phase = savedPhase(form, custom);
  const settings: Settings = {};
  if (custom) settings.resultType = form.resultType;
  const keywords = normalizeCustomAgentActivationKeywords(form.activationKeywords);
  if (custom && keywords.length > 0) {
    settings.activationKeywords = keywords;
    settings.activationScanDepth =
      form.activationScanDepth === ""
        ? normalizeCustomAgentActivationScanDepth(undefined)
        : normalizeCustomAgentActivationScanDepth(form.activationScanDepth);
  }
  if (custom && phase === "post_processing") {
    if (form.includePreGenInjections) settings.includePreGenInjections = true;
    if (form.includeParallelResults) settings.includeParallelResults = true;
  }
  if (form.contextSize !== "") settings.contextSize = Number(form.contextSize);
  if (form.maxTokens !== "") settings.maxTokens = Math.trunc(Number(clampMaxTokens(form.maxTokens)));
  if (form.runInterval !== "") settings.runInterval = Number(form.runInterval);
  if (form.injectAsSection) settings.injectAsSection = true;
  settings.enabledTools = writer.enabledTools;
  Object.assign(settings, writer.writerSettings);
  if (isType("knowledge-retrieval") || isType("knowledge-router")) {
    settings.useChatActiveLorebooks = form.useChatActiveLorebooks;
  }
  if (form.sourceLorebookIds.length > 0) settings.sourceLorebookIds = form.sourceLorebookIds;
  if (isType("knowledge-retrieval") && form.sourceFileIds.length > 0) settings.sourceFileIds = form.sourceFileIds;
  if (form.imageConnectionId) settings.imageConnectionId = form.imageConnectionId;
  if (form.autoGenerateAvatars) settings.autoGenerateAvatars = true;
  if (form.autoGenerateBackgrounds) settings.autoGenerateBackgrounds = true;
  if (isType("illustrator"))
    Object.assign(settings, serializeIllustratorAvatarReferenceSettings(form.avatarReferenceMode));
  if (form.imagePositivePrompt.trim()) settings.imagePositivePrompt = form.imagePositivePrompt.trim();
  if (form.imageNegativePrompt.trim()) settings.imageNegativePrompt = form.imageNegativePrompt.trim();
  return {
    name: form.name,
    description: form.description,
    credit: agentCreditLabel(form.author),
    phase: phase as AgentPhase,
    enabled: form.enabled,
    connectionId: form.connectionId || null,
    promptTemplate: form.promptTemplate,
    settings,
  };
}
