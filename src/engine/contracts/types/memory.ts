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
    Pick<
      CanonicalMemoryRecord,
      "status" | "title" | "tags" | "supersedesMemoryId" | "supersededByMemoryId" | "payload"
    >
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
}

export interface MemoryIndexRow {
  id: string;
  memoryId: string;
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
