import { describe, expect, it } from "vitest";
import { knowledgeEdgesForCapturedMemory } from "./automatic-memory-knowledge";

const base = {
  memoryId: "memory-1",
  memoryKind: "fact" as const,
  sourceChatId: "chat-1",
  sourceMessageIds: ["user-1", "assistant-1"],
  now: "2026-08-30T12:00:00Z",
};

describe("automatic memory deterministic knowledge", () => {
  it("grants a targeted disclosure only to the target character and persona", () => {
    const edges = knowledgeEdgesForCapturedMemory({
      ...base,
      scopeReason: "attributed_character",
      characterId: "alice",
      personaId: "persona-1",
      sceneId: null,
      participantCharacterIds: [],
    });

    expect(edges.map((edge) => [edge.holder.kind, edge.holder.id, edge.stance])).toEqual([
      ["character", "alice", "believes"],
      ["persona", "persona-1", "believes"],
    ]);
  });

  it("grants a witnessed scene event to every explicit participant and world truth", () => {
    const edges = knowledgeEdgesForCapturedMemory({
      ...base,
      memoryKind: "scene_event",
      scopeReason: "ambiguous_scene",
      characterId: null,
      personaId: "persona-1",
      sceneId: "scene-1",
      participantCharacterIds: ["alice", "bob", "alice"],
    });

    expect(edges.map((edge) => [edge.holder.kind, edge.holder.id, edge.stance])).toEqual([
      ["character", "alice", "knows"],
      ["character", "bob", "knows"],
      ["persona", "persona-1", "knows"],
      ["world", "world", "knows"],
    ]);
  });

  it("does not infer knowledge from ambiguous ordinary merged chat membership", () => {
    expect(
      knowledgeEdgesForCapturedMemory({
        ...base,
        scopeReason: "ambiguous_chat",
        characterId: null,
        personaId: "persona-1",
        sceneId: null,
        participantCharacterIds: ["alice", "bob"],
      }),
    ).toEqual([]);
  });
});
