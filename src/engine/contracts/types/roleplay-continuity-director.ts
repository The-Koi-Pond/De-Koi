export type ContinuityDirectorItemSource = "director" | "user";

export type ContinuityDirectorBeatStatus = "proposed" | "approved" | "deferred" | "rejected" | "fulfilled";

export type ContinuityDirectorThreadStatus = "open" | "deferred" | "resolved";

export type ContinuityDirectorRefreshMode = "manual" | "scene_events" | "cadence";

export interface ContinuityDirectorArc {
  id: string;
  text: string;
  source: ContinuityDirectorItemSource;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityDirectorThread {
  id: string;
  text: string;
  status: ContinuityDirectorThreadStatus;
  source: ContinuityDirectorItemSource;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityDirectorBeat {
  id: string;
  text: string;
  status: ContinuityDirectorBeatStatus;
  order: number;
  source: ContinuityDirectorItemSource;
  sourceIds: string[];
  characterIds: string[];
  threadIds: string[];
  resolution?: "rerolled";
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityDirectorSourceSnapshot {
  storyProjectionIds: string[];
  knowledgeEdgeIds: string[];
  lastMessageId: string | null;
  visibleAssistantTurnCount?: number;
  fingerprint: string;
  generatedAt: string;
}

export interface RoleplayContinuityDirectorState {
  version: 1;
  revision: number;
  enabled: boolean;
  connectionId: string | null;
  refreshMode: ContinuityDirectorRefreshMode;
  refreshEveryAssistantTurns: number | null;
  currentArc: ContinuityDirectorArc | null;
  openThreads: ContinuityDirectorThread[];
  beats: ContinuityDirectorBeat[];
  sourceSnapshot: ContinuityDirectorSourceSnapshot | null;
  /** Durable cadence baseline for model attempts that did not produce a successful source snapshot. */
  lastPlanningAttemptAssistantTurnCount?: number | null;
  updatedAt: string;
}

export type ContinuityDirectorCommand =
  | { type: "set_enabled"; enabled: boolean }
  | { type: "set_connection"; connectionId: string | null }
  | {
      type: "set_refresh_policy";
      mode: ContinuityDirectorRefreshMode;
      everyAssistantTurns?: number | null;
    }
  | { type: "edit_arc"; text: string }
  | { type: "edit_thread"; threadId: string; text: string }
  | { type: "set_thread_status"; threadId: string; status: ContinuityDirectorThreadStatus }
  | { type: "edit_beat"; beatId: string; text: string }
  | { type: "set_beat_status"; beatId: string; status: ContinuityDirectorBeatStatus }
  | { type: "move_beat"; beatId: string; direction: "up" | "down" }
  | { type: "reroll_beat"; beatId: string; replacementText: string }
  | {
      type: "replace_director_proposals";
      arc?: string | null;
      threads?: string[];
      beats: string[];
      sourceSnapshot?: ContinuityDirectorSourceSnapshot | null;
    };
