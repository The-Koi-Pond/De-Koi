import type { StorageGateway } from "../capabilities/storage";
import type { KnowledgeEdge } from "../contracts/types/memory";
import type { EpistemicGroup, EpistemicSubject } from "./epistemic-access";
import { isRecord, readString } from "./runtime-records";

export interface LoadedEpistemicContext {
  enabled: boolean;
  subjects: EpistemicSubject[];
  groups: EpistemicGroup[];
  holderEdges: KnowledgeEdge[];
}

export function epistemicSubjectsForGeneration(input: {
  impersonate: boolean;
  persona?: { id: string; name?: string | null } | null;
  characters: Array<{ id: string; name?: string | null }>;
}): EpistemicSubject[] {
  if (input.impersonate) {
    const id = input.persona?.id?.trim() ?? "";
    return id ? [{ kind: "persona", id, name: input.persona?.name?.trim() || undefined }] : [];
  }
  return input.characters
    .map((character) => ({
      kind: "character" as const,
      id: character.id.trim(),
      name: character.name?.trim() || undefined,
    }))
    .filter((subject) => subject.id);
}

export async function loadEpistemicContext(
  storage: StorageGateway,
  subjects: EpistemicSubject[],
): Promise<LoadedEpistemicContext> {
  const validSubjects = subjects.filter((subject) => subject.id.trim());
  if (!storage.queryKnowledgeEdges || validSubjects.length === 0) {
    return { enabled: false, subjects: validSubjects, groups: [], holderEdges: [] };
  }
  try {
    const rawGroups = await storage.list<unknown>("character-groups");
    const groups = rawGroups
      .filter(isRecord)
      .map((row) => ({
        id: readString(row.id).trim(),
        characterIds: Array.isArray(row.characterIds)
          ? row.characterIds.map((id) => readString(id).trim()).filter(Boolean)
          : [],
      }))
      .filter((group) => group.id);
    const subjectHolders = validSubjects.map((subject) => ({ kind: subject.kind, id: subject.id }));
    const subjectIds = new Set(
      validSubjects.filter((subject) => subject.kind === "character").map((subject) => subject.id),
    );
    const groupHolders = groups
      .filter((group) => group.characterIds.some((id) => subjectIds.has(id)))
      .map((group) => ({ kind: "group" as const, id: group.id }));
    const holderEdges = await storage.queryKnowledgeEdges({
      holders: [...subjectHolders, ...groupHolders],
      statuses: ["active", "invalidated"],
    });
    return { enabled: true, subjects: validSubjects, groups, holderEdges };
  } catch {
    return { enabled: false, subjects: validSubjects, groups: [], holderEdges: [] };
  }
}
