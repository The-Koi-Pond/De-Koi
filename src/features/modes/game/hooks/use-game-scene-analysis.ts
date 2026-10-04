import { useMutation } from "../../../../shared/hooks/use-mutation";
import type { SceneAnalysis } from "../../../../engine/contracts/types/scene";
import {
  analyzeGameScene,
  type GameSceneAnalysisRequest,
} from "../../../../engine/modes/game/scene/game-scene-analysis.service";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";

export function useGameSceneAnalysis() {
  return useMutation({
    mutationFn: (request: GameSceneAnalysisRequest): Promise<SceneAnalysis> =>
      analyzeGameScene({ storage: storageApi, llm: llmApi }, request),
  });
}
