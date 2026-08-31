export type MemoryKind =
  | "episode"
  | "fact"
  | "scene_event"
  | "relationship_state"
  | "preference"
  | "promise"
  | "plot_state"
  | "contradiction"
  | "lore"
  | "summary";
export type MemoryStatus = "active" | "superseded" | "stale" | "pinned" | "deleted";
export type MemoryScopeKind = "user" | "character" | "chat" | "scene" | "world" | "agent";

export type KnowledgeHolderKind = "character" | "persona" | "group" | "world";
export type KnowledgeStance = "knows" | "believes" | "suspects" | "disbelieves" | "unknown";
export type KnowledgeEdgeStatus = "active" | "proposed" | "invalidated";
export type KnowledgeEvidenceKind =
  | "user_edit"
  | "targeted_disclosure"
  | "scene_witness"
  | "import"
  | "supersession";

export interface KnowledgeHolder {
  kind: KnowledgeHolderKind;
  id: string;
}

export interface KnowledgeEdgeProvenance {
  kind: KnowledgeEvidenceKind;
  author: "user" | "system";
  sourceChatId?: string | null;
  messageIds: string[];
  sceneId?: string | null;
  createdAt: string;
}

export interface KnowledgeEdge {
  id: string;
  memoryId: string;
  holder: KnowledgeHolder;
  stance: KnowledgeStance;
  status: KnowledgeEdgeStatus;
  confidence?: number | null;
  provenance: KnowledgeEdgeProvenance[];
  invalidatedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeEdgeInput = Pick<KnowledgeEdge, "memoryId" | "holder" | "stance" | "provenance"> &
  Partial<Pick<KnowledgeEdge, "status" | "confidence">>;

export interface KnowledgeEdgeQuery {
  memoryIds?: string[];
  holders?: KnowledgeHolder[];
  statuses?: KnowledgeEdgeStatus[];
}

export interface MemoryScope {
  kind: MemoryScopeKind;
  id: string;
}

export interface MemoryProvenance {
  sourceChatId?: string | null;
  messageIds: string[];
  sceneId?: string | null;
  characterId?: string | null;
  timestamp?: string | null;
}

export type StoryProjectionLevel = "episode" | "arc";
export type StoryEpisodeBoundaryReason = "message_threshold" | "manual" | "scene_conclusion";
export type StoryProjectionJobStatus = "pending" | "processing" | "retryable" | "completed" | "failed" | "stale";

export interface StoryProjectionCitation {
  text: string;
  sourceMessageIds?: string[];
  sourceEpisodeIds?: string[];
}

export interface StoryProjectionSections {
  events: StoryProjectionCitation[];
  choices: StoryProjectionCitation[];
  relationshipShifts: StoryProjectionCitation[];
  promises: StoryProjectionCitation[];
  reveals: StoryProjectionCitation[];
  unresolvedHooks: StoryProjectionCitation[];
  currentState: StoryProjectionCitation[];
}

export interface StoryProjectionPayload extends Record<string, unknown> {
  storyProjectionVersion: 1;
  level: StoryProjectionLevel;
  ownerChatId: string;
  coverageId: string;
  sourceFingerprint: string;
  messageIds: string[];
  sourceMessages?: Array<{ id: string; role: string; content: string; createdAt?: string | null }>;
  firstMessageId: string;
  lastMessageId: string;
  boundaryReason?: StoryEpisodeBoundaryReason | null;
  sourceEpisodeIds: string[];
  sections: StoryProjectionSections;
  summarizer: {
    version: string;
    connectionId?: string | null;
    provider?: string | null;
    model?: string | null;
    completedAt: string;
  };
  staleReason?: string | null;
  staleAt?: string | null;
}

export interface StoryProjectionJob extends Record<string, unknown> {
  id: string;
  status: StoryProjectionJobStatus;
  level: StoryProjectionLevel;
  ownerChatId: string;
  coverageId: string;
  sourceFingerprint: string;
  sourceMessageIds: string[];
  sourceEpisodeIds: string[];
  sourceMessages: Array<{ id: string; role: string; content: string; createdAt?: string | null }>;
  sourceEpisodes: Array<{ id: string; title?: string | null; content: string; messageIds: string[] }>;
  boundaryReason?: StoryEpisodeBoundaryReason | null;
  supersedesMemoryId?: string | null;
  projectionMemoryId?: string | null;
  followUp?: "arc_enqueue" | null;
  parentArcJobId?: string | null;
  lastError?: string | null;
  connectionId?: string | null;
  provider?: string | null;
  model?: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalMemoryRecord {
  id: string;
  kind: MemoryKind;
  status: MemoryStatus;
  scope: MemoryScope;
  content: string;
  confidence: number;
  provenance: MemoryProvenance;
  title?: string | null;
  tags: string[];
  supersedesMemoryId?: string | null;
  supersededByMemoryId?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type CanonicalMemoryInput = Pick<
  CanonicalMemoryRecord,
  "kind" | "scope" | "content" | "confidence" | "provenance"
> &
  Partial<
    Pick<CanonicalMemoryRecord, "status" | "title" | "tags" | "supersedesMemoryId" | "supersededByMemoryId" | "payload">
  > & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  };

export type CanonicalMemoryPatch = Partial<
  Pick<
    CanonicalMemoryRecord,
    | "kind"
    | "status"
    | "scope"
    | "content"
    | "confidence"
    | "provenance"
    | "title"
    | "tags"
    | "supersedesMemoryId"
    | "supersededByMemoryId"
    | "payload"
  >
>;

export interface CanonicalMemoryQuery {
  scope?: MemoryScope;
  statuses?: MemoryStatus[];
  includeInactive?: boolean;
  memoryIds?: string[];
  epistemicPolicyVersion?: 1;
}

export interface CanonicalMemorySemanticQuery {
  queryText: string;
  queries: CanonicalMemoryQuery[];
  connectionId: string;
  limit?: number;
  similarityThreshold?: number;
  epistemicPolicyVersion?: 1;
}

export interface CanonicalMemorySemanticMatch {
  memory: CanonicalMemoryRecord;
  similarity: number;
  connectionId: string;
  provider: string;
  model: string;
}

export interface MemoryIndexRow {
  id: string;
  memoryId: string;
  connectionId?: string | null;
  provider: string;
  model: string;
  dimensions: number;
  contentHash: string;
  projectionHash: string;
  canonicalUpdatedAt: string;
  vector?: number[] | null;
  lexicalTokens?: string[];
  createdAt: string;
  updatedAt: string;
}

export type MemoryIndexRowInput = Omit<MemoryIndexRow, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface MemoryIndexDeleteResult {
  deleted: number;
}

export interface MemoryLexicalRebuildResult {
  rebuilt: number;
}

export interface MemoryIndexHealth {
  version: 1;
  lexicalComplete: boolean;
}
