import type {
  CanonicalMemoryInput,
  CanonicalMemoryRecord,
  StoryProjectionJob,
} from "../../engine/contracts/types/memory";
import { invokeTauri } from "./tauri-client";

export interface StoryProjectionCommitResult {
  memory: CanonicalMemoryRecord;
  job: StoryProjectionJob;
}

export const storyConsolidationRuntimeApi = {
  updateJob: (leaseId: string, jobId: string, patch: Record<string, unknown>) =>
    invokeTauri<StoryProjectionJob>("story_consolidation_job_update", {
      body: { leaseId, jobId, patch },
    }),
  commitProjection: (leaseId: string, jobId: string, memory: CanonicalMemoryInput) =>
    invokeTauri<StoryProjectionCommitResult>("story_consolidation_projection_commit", {
      body: { leaseId, jobId, memory },
    }),
};
