export type NarrativeCraftPacing = "quiet" | "exploring" | "building" | "turning" | "aftermath";

export interface NarrativeCraftThread {
  id: string;
  summary: string;
  kind: "main" | "subplot";
  status: "active" | "dormant" | "unresolved";
}

export interface NarrativeCraftState {
  version: 1;
  pacing: NarrativeCraftPacing;
  threads: NarrativeCraftThread[];
  openQuestions: string[];
  withheldInformation: string[];
  unresolvedConsequences: string[];
  recentShapeChoices: string[];
  lastGuidance: string[];
  pendingGuidance: string[];
  lastAnalysisReason: string;
}

export function emptyNarrativeCraftState(): NarrativeCraftState {
  return {
    version: 1,
    pacing: "quiet",
    threads: [],
    openQuestions: [],
    withheldInformation: [],
    unresolvedConsequences: [],
    recentShapeChoices: [],
    lastGuidance: [],
    pendingGuidance: [],
    lastAnalysisReason: "",
  };
}

const PACING_VALUES = new Set<NarrativeCraftPacing>(["quiet", "exploring", "building", "turning", "aftermath"]);
const THREAD_KINDS = new Set<NarrativeCraftThread["kind"]>(["main", "subplot"]);
const THREAD_STATUSES = new Set<NarrativeCraftThread["status"]>(["active", "dormant", "unresolved"]);

function cleanString(value: unknown): string {
  return readString(value).trim();
}

function normalizePacing(value: unknown): NarrativeCraftPacing {
  const pacing = cleanString(value).toLowerCase();
  if (PACING_VALUES.has(pacing as NarrativeCraftPacing)) return pacing as NarrativeCraftPacing;
  if (["slow", "resting"].includes(pacing)) return "quiet";
  if (["discovery", "discovering"].includes(pacing)) return "exploring";
  if (["rising", "escalating"].includes(pacing)) return "building";
  if (["climax", "climactic"].includes(pacing)) return "turning";
  if (["falling", "resolution", "resolving"].includes(pacing)) return "aftermath";
  return "quiet";
}

function normalizeStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanString(entry))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeThreads(value: unknown): NarrativeCraftThread[] {
  if (!Array.isArray(value)) return [];
  const threads: NarrativeCraftThread[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const summary = cleanString(entry.summary);
    if (!summary) continue;
    const kind = cleanString(entry.kind);
    const status = cleanString(entry.status);
    threads.push({
      id: cleanString(entry.id) || `thread-${threads.length + 1}`,
      summary,
      kind: THREAD_KINDS.has(kind as NarrativeCraftThread["kind"]) ? (kind as NarrativeCraftThread["kind"]) : "subplot",
      status: THREAD_STATUSES.has(status as NarrativeCraftThread["status"])
        ? (status as NarrativeCraftThread["status"])
        : "active",
    });
    if (threads.length === 6) break;
  }
  return threads;
}

export function normalizeNarrativeCraftState(value: unknown): NarrativeCraftState {
  if (!isRecord(value)) return emptyNarrativeCraftState();
  return {
    version: 1,
    pacing: normalizePacing(value.pacing),
    threads: normalizeThreads(value.threads),
    openQuestions: normalizeStrings(value.openQuestions, 5),
    withheldInformation: normalizeStrings(value.withheldInformation, 4),
    unresolvedConsequences: normalizeStrings(value.unresolvedConsequences, 5),
    recentShapeChoices: normalizeStrings(value.recentShapeChoices, 6),
    lastGuidance: normalizeStrings(value.lastGuidance, 2),
    pendingGuidance: normalizeStrings(value.pendingGuidance, 1),
    lastAnalysisReason: cleanString(value.lastAnalysisReason),
  };
}

export function narrativeCraftPromptGuidanceFromData(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return cleanString(value.text) || null;
}

function legacyArcSummary(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  for (const key of ["summary", "title", "premise", "name", "currentState"]) {
    const summary = cleanString(value[key]);
    if (summary) return summary;
  }
  return "";
}

export function narrativeCraftStateFromLegacyMemory(memory: Record<string, unknown>): NarrativeCraftState {
  const threads: NarrativeCraftThread[] = [];
  const arc = legacyArcSummary(memory.overarchingArc);
  if (arc) {
    threads.push({ id: "legacy-main", summary: arc, kind: "main", status: "active" });
  }
  const activeDirections = normalizeSecretPlotSceneDirections(memory.sceneDirections).filter(
    (direction) => !direction.fulfilled,
  );
  activeDirections.forEach((direction, index) => {
    if (threads.length >= 6) return;
    threads.push({
      id: `legacy-direction-${index + 1}`,
      summary: direction.direction,
      kind: "subplot",
      status: "active",
    });
  });
  return {
    ...emptyNarrativeCraftState(),
    pacing: normalizePacing(memory.pacing),
    threads,
  };
}
import { normalizeSecretPlotSceneDirections } from "./agent-normalizers";
import { isRecord, readString } from "./runtime-records";
