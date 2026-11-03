import { useQuery } from "@tanstack/react-query";
import { modelRoutingApi, modelRoutingKeys } from "../../../../shared/api/model-routing-api";

/**
 * Where each background helper last ran and why. `fresh` re-reads on every mount (Helper Models, which also shows
 * runs from the hosted runner and other tabs); fic panels refresh it when a helper they started finishes.
 */
export function useHelperRuns({ fresh = false }: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: modelRoutingKeys.runs,
    queryFn: modelRoutingApi.runs,
    ...(fresh ? { staleTime: 0, refetchOnMount: "always" as const } : {}),
  });
}
