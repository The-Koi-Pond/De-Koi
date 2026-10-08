import { invokeTauri } from "./tauri-client";
import { invalidateRemoteManagedAssetObjectUrlsAfter } from "./local-file-api";

export interface LorebookVectorizeInput {
  connectionId?: string;
  model?: string;
  onlyMissing: boolean;
  entryIds?: string[];
}

export type LorebookKeeperReviewTransitionStatus = "pending" | "applying" | "applied" | "rejected";

export interface LorebookKeeperReviewTransition {
  /** False when the proposal had already moved past `expectedStatuses`; `status` is what it is now. */
  updated: boolean;
  status: string;
}

export const lorebookCommandApi = {
  /**
   * Move one stored Keeper proposal to `status`, only if it is still one of `expectedStatuses`
   * (checked and written atomically by the runtime).
   */
  keeperReviewUpdate: (input: {
    runId: string;
    updateIndex: number;
    expectedStatuses: LorebookKeeperReviewTransitionStatus[];
    status: LorebookKeeperReviewTransitionStatus;
  }) => invokeTauri<LorebookKeeperReviewTransition>("agent_run_keeper_review_update", input, { timeoutMs: null }),
  uploadImage: <T = unknown>(id: string, image: string, filename?: string) =>
    invalidateRemoteManagedAssetObjectUrlsAfter(
      invokeTauri<T>("lorebook_image_upload", { id, body: { image, filename } }),
      "lorebook",
    ),
  vectorize: <T = unknown>(id: string, body: LorebookVectorizeInput) =>
    invokeTauri<T>("lorebook_vectorize", { id, body }),
};
