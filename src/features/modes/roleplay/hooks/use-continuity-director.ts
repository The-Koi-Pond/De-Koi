import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ContinuityDirectorCommand } from "../../../../engine/contracts/types/roleplay-continuity-director";
import {
  roleplayContinuityDirectorApi,
  type ContinuityDirectorStateView,
  type RoleplayContinuityDirectorApi,
} from "../../../../shared/api/roleplay-continuity-director-api";
import { chatKeys } from "../../../catalog/chats";

export const continuityDirectorKeys = {
  all: ["roleplay-continuity-director"] as const,
  state: (chatId: string) => [...continuityDirectorKeys.all, "state", chatId] as const,
};

export function useContinuityDirector(
  chatId: string | null | undefined,
  api: RoleplayContinuityDirectorApi = roleplayContinuityDirectorApi,
) {
  const queryClient = useQueryClient();
  const normalizedChatId = chatId?.trim() ?? "";
  const queryKey = continuityDirectorKeys.state(normalizedChatId);
  const query = useQuery({
    queryKey,
    queryFn: () => api.getState(normalizedChatId),
    enabled: Boolean(normalizedChatId),
    staleTime: 5_000,
  });

  const publish = async (value: ContinuityDirectorStateView) => {
    queryClient.setQueryData(queryKey, value);
    await queryClient.invalidateQueries({ queryKey: chatKeys.detail(normalizedChatId) });
    return value;
  };

  const command = useMutation({
    mutationFn: (input: { command: ContinuityDirectorCommand; expectedRevision?: number }) =>
      api.command(normalizedChatId, input.command, input.expectedRevision),
    onSuccess: publish,
  });

  const refresh = useMutation({
    mutationFn: () => api.refresh(normalizedChatId),
    onSuccess: publish,
  });

  const reroll = useMutation({
    mutationFn: (beatId: string) => api.reroll(normalizedChatId, beatId),
    onSuccess: publish,
  });

  return {
    state: query.data?.state,
    isStale: query.data?.isStale ?? false,
    sourceUnavailable: query.data?.sourceUnavailable ?? false,
    isLoading: query.isLoading,
    error: query.error,
    command,
    refresh,
    reroll,
  };
}

export type UseContinuityDirectorResult = ReturnType<typeof useContinuityDirector>;
