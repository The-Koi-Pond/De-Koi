export type MemoryCleanupScope =
  | { kind: "chat"; id: string }
  | { kind: "scene"; id: string }
  | { kind: "character"; id: string };

type MemoryCleanupStatus = "active" | "pinned" | "deleted" | "wrong" | "stale" | "superseded";

type MemoryCleanupOrigin = "automatic" | "cleanup" | "manual" | "imported" | "correction" | "command";

export interface MemoryCleanupExpectedState {
  content: string;
  status: MemoryCleanupStatus;
  updatedAt: string | null;
  pinned: boolean;
  userEdited: boolean;
}

export interface MemoryCleanupSource {
  id: string;
  scope: MemoryCleanupScope;
  content: string;
  kind: string;
  status: MemoryCleanupStatus;
  origin: MemoryCleanupOrigin;
  confidence: number | null;
  messageIds: string[];
  sourceChatIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
  pinned: boolean;
  userEdited: boolean;
  embedding?: number[];
}

export const MEMORY_CLEANUP_MAX_SELECTED_PROPOSALS = 1_000;

export type MemoryCleanupProposalType = "discard" | "keep_one" | "combine" | "conflict";

export type MemoryCleanupReason =
  | "Low-value memory"
  | "Repeated fact"
  | "Overlapping memories"
  | "Possible conflict";

export interface MemoryCleanupProposal {
  id: string;
  type: MemoryCleanupProposalType;
  /** Rows consumed by Apply. For keep_one, this excludes winnerId. */
  sourceIds: string[];
  expected: Record<string, MemoryCleanupExpectedState>;
  winnerId?: string;
  replacement?: { content: string; kind: string };
  reason: MemoryCleanupReason;
  selected: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

export interface MemoryCleanupPreview {
  version: 1;
  scope: MemoryCleanupScope;
  proposals: MemoryCleanupProposal[];
  beforeCount: number;
  afterCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  deferredCandidateCount: number;
}

export interface MemoryCleanupApplyRequest {
  version: 1;
  scope: MemoryCleanupScope;
  proposals: MemoryCleanupProposal[];
}

export interface MemoryCleanupApplyResult {
  batchId: string;
  combined: number;
  discarded: number;
  superseded: number;
  created: number;
}

export interface MemoryCleanupUndoRequest {
  scope: MemoryCleanupScope;
  batchId: string;
}

export interface MemoryCleanupUndoResult {
  batchId: string;
  restored: number;
  inactivated: number;
}
