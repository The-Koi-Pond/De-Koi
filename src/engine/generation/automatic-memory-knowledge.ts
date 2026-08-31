import type { KnowledgeEdgeInput, KnowledgeEvidenceKind, KnowledgeStance, MemoryKind } from "../contracts/types/memory";

export interface CapturedMemoryKnowledgeInput {
  memoryId: string;
  memoryKind: MemoryKind;
  scopeReason: "attributed_character" | "character_chat_only" | "ambiguous_scene" | "ambiguous_chat";
  characterId?: string | null;
  personaId?: string | null;
  sceneId?: string | null;
  participantCharacterIds: string[];
  sourceChatId: string;
  sourceMessageIds: string[];
  now: string;
}

function edge(
  input: CapturedMemoryKnowledgeInput,
  holder: KnowledgeEdgeInput["holder"],
  stance: KnowledgeStance,
  kind: KnowledgeEvidenceKind,
): KnowledgeEdgeInput {
  return {
    memoryId: input.memoryId,
    holder,
    stance,
    status: "active",
    provenance: [
      {
        kind,
        author: "system",
        sourceChatId: input.sourceChatId,
        messageIds: Array.from(new Set(input.sourceMessageIds.filter(Boolean))),
        sceneId: input.sceneId ?? null,
        createdAt: input.now,
      },
    ],
  };
}

export function knowledgeEdgesForCapturedMemory(input: CapturedMemoryKnowledgeInput): KnowledgeEdgeInput[] {
  const memoryId = input.memoryId.trim();
  if (!memoryId) return [];
  const personaId = input.personaId?.trim() ?? "";
  const witnessedScene =
    !!input.sceneId?.trim() &&
    (input.memoryKind === "scene_event" || input.memoryKind === "episode");
  if (witnessedScene) {
    const characterIds = Array.from(new Set(input.participantCharacterIds.map((id) => id.trim()).filter(Boolean)));
    if (characterIds.length === 0) return [];
    return [
      ...characterIds.map((id) => edge(input, { kind: "character", id }, "knows", "scene_witness")),
      ...(personaId ? [edge(input, { kind: "persona", id: personaId }, "knows", "scene_witness")] : []),
      edge(input, { kind: "world", id: "world" }, "knows", "scene_witness"),
    ];
  }

  const characterId = input.characterId?.trim() ?? "";
  if (input.scopeReason !== "attributed_character" || !characterId) return [];
  return [
    edge(input, { kind: "character", id: characterId }, "believes", "targeted_disclosure"),
    ...(personaId
      ? [edge(input, { kind: "persona", id: personaId }, "believes", "targeted_disclosure")]
      : []),
  ];
}
