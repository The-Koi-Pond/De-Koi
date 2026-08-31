import type { KnowledgeEdge, KnowledgeHolderKind, KnowledgeStance } from "../contracts/types/memory";

export type EpistemicAccessReason =
  | "legacy_fallback"
  | "direct_edge"
  | "group_edge"
  | "missing_edge"
  | "unknown"
  | "group_conflict"
  | "merged_intersection_failed"
  | "epistemic_unavailable";

export interface EpistemicSubject {
  kind: Extract<KnowledgeHolderKind, "character" | "persona">;
  id: string;
  name?: string;
}

export interface EpistemicGroup {
  id: string;
  characterIds: string[];
}

export interface EpistemicSubjectDecision {
  subject: EpistemicSubject;
  admitted: boolean;
  stance?: KnowledgeStance;
  edgeIds: string[];
  reason: Exclude<EpistemicAccessReason, "legacy_fallback" | "merged_intersection_failed" | "epistemic_unavailable">;
}

export interface EpistemicAccessResult {
  admitted: boolean;
  classified: boolean;
  reason: EpistemicAccessReason;
  decisions: EpistemicSubjectDecision[];
  edgeIds: string[];
}

export interface ResolveEpistemicAccessInput {
  memoryId: string;
  edges: KnowledgeEdge[];
  subjects: EpistemicSubject[];
  groups: EpistemicGroup[];
}

const ADMITTED_STANCES = new Set<KnowledgeStance>(["knows", "believes", "suspects", "disbelieves"]);

function subjectDecision(
  subject: EpistemicSubject,
  activeEdges: KnowledgeEdge[],
  groups: EpistemicGroup[],
): EpistemicSubjectDecision {
  const direct = activeEdges.find((edge) => edge.holder.kind === subject.kind && edge.holder.id === subject.id);
  if (direct) {
    return {
      subject,
      admitted: ADMITTED_STANCES.has(direct.stance),
      stance: direct.stance,
      edgeIds: [direct.id],
      reason: direct.stance === "unknown" ? "unknown" : "direct_edge",
    };
  }

  const groupIds = new Set(
    subject.kind === "character"
      ? groups.filter((group) => group.characterIds.includes(subject.id)).map((group) => group.id)
      : [],
  );
  const groupEdges = activeEdges.filter((edge) => edge.holder.kind === "group" && groupIds.has(edge.holder.id));
  if (groupEdges.length === 0) {
    return { subject, admitted: false, edgeIds: [], reason: "missing_edge" };
  }

  const stances = new Set(groupEdges.map((edge) => edge.stance));
  if (stances.size !== 1) {
    return {
      subject,
      admitted: false,
      edgeIds: groupEdges.map((edge) => edge.id),
      reason: "group_conflict",
    };
  }
  const stance = groupEdges[0]!.stance;
  return {
    subject,
    admitted: ADMITTED_STANCES.has(stance),
    stance,
    edgeIds: groupEdges.map((edge) => edge.id),
    reason: stance === "unknown" ? "unknown" : "group_edge",
  };
}

export function resolveEpistemicAccess(input: ResolveEpistemicAccessInput): EpistemicAccessResult {
  const relevant = input.edges.filter((edge) => edge.memoryId === input.memoryId);
  const classified = relevant.some((edge) => edge.status === "active" || edge.status === "invalidated");
  if (!classified) {
    return { admitted: true, classified: false, reason: "legacy_fallback", decisions: [], edgeIds: [] };
  }

  const activeEdges = relevant.filter((edge) => edge.status === "active");
  const decisions = input.subjects.map((subject) => subjectDecision(subject, activeEdges, input.groups));
  const admitted = decisions.length > 0 && decisions.every((decision) => decision.admitted);
  const failedReasons = decisions.filter((decision) => !decision.admitted).map((decision) => decision.reason);
  const reason: EpistemicAccessReason = admitted
    ? decisions.every((decision) => decision.reason === "direct_edge")
      ? "direct_edge"
      : "group_edge"
    : decisions.length > 1
      ? "merged_intersection_failed"
      : (failedReasons[0] ?? "missing_edge");
  return {
    admitted,
    classified: true,
    reason,
    decisions,
    edgeIds: Array.from(new Set(decisions.flatMap((decision) => decision.edgeIds))),
  };
}

function displayName(subject: EpistemicSubject): string {
  const name = subject.name?.trim() || subject.id.replace(/[-_]+/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function formatEpistemicMemory(
  content: string,
  decisions: Array<{ subject: EpistemicSubject; stance?: KnowledgeStance }>,
): string {
  if (decisions.length === 0) return content;
  const labels = decisions.map(({ subject, stance }) => {
    const name = displayName(subject);
    if (stance === "believes") return `${name} believes`;
    if (stance === "suspects") return `${name} suspects`;
    if (stance === "disbelieves") return `${name} has heard but disbelieves`;
    return `${name} knows`;
  });
  return `${labels.join("; ")}: ${content}`;
}
