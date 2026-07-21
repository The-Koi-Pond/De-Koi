import { useCallback, useMemo, useRef } from "react";
import { useMutation, useMutationState, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

export interface EnabledToggleVariables {
  id: string;
  enabled: boolean;
}

export function useEnabledToggleMutation({
  mutationKey,
  queryKey,
  update,
  errorMessage,
}: {
  mutationKey: QueryKey;
  queryKey: QueryKey;
  update: (id: string, enabled: boolean) => Promise<unknown>;
  errorMessage: string;
}) {
  const qc = useQueryClient();
  const submittedIdsRef = useRef(new Set<string>());
  const mutation = useMutation({
    mutationKey,
    mutationFn: ({ id, enabled }: EnabledToggleVariables) => update(id, enabled),
    onError: () => toast.error(errorMessage),
    onSettled: (_data, error, variables) => {
      submittedIdsRef.current.delete(variables.id);
      if (!error) return qc.invalidateQueries({ queryKey });
    },
  });
  const pendingToggles = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (pendingMutation) => pendingMutation.state.variables as EnabledToggleVariables,
  });
  const pendingEnabledById = useMemo(
    () => new Map(pendingToggles.map(({ id, enabled }) => [id, enabled])),
    [pendingToggles],
  );
  const { mutate } = mutation;
  const setEnabled = useCallback(
    (variables: EnabledToggleVariables): boolean => {
      if (submittedIdsRef.current.has(variables.id)) return false;
      submittedIdsRef.current.add(variables.id);
      mutate(variables);
      return true;
    },
    [mutate],
  );

  return { ...mutation, pendingEnabledById, setEnabled };
}
