import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, getExpungeFailureReceipt } from "../../../../shared/api/admin-api";
import { resetClientSessionState } from "../../actions";

export type ExpungeScope =
  | "chats"
  | "characters"
  | "personas"
  | "lorebooks"
  | "presets"
  | "connections"
  | "automation"
  | "media";

export function useExpungeData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scopes: ExpungeScope[]) => adminApi.expunge(scopes),
    onSuccess: async () => {
      resetClientSessionState(qc);
    },
    onError: (error) => {
      const receipt = getExpungeFailureReceipt(error);
      if (receipt && (receipt.completedScopes.length > 0 || receipt.clearedCollections.length > 0)) {
        resetClientSessionState(qc);
      }
    },
  });
}

export function useClearAllData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.clearAll(),
    onSuccess: async () => {
      resetClientSessionState(qc);
      window.localStorage.clear();
      window.sessionStorage.clear();
    },
  });
}
