import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "../../../../shared/hooks/use-mutation";

import type { RoleplayWorldTickState, WorldTickCommand } from "../../../../engine/contracts/types/roleplay-world-tick";
import {
  roleplayWorldTickApi,
  roleplayWorldTickKeys,
  type RoleplayWorldTickApi,
} from "../../../../shared/api/roleplay-world-tick-api";
import { chatKeys } from "../../../catalog/chats";

export function useWorldTick(chatId: string | null | undefined, api: RoleplayWorldTickApi = roleplayWorldTickApi) {
  const queryClient = useQueryClient();
  const normalizedChatId = chatId?.trim() ?? "";
  const queryKey = roleplayWorldTickKeys.state(normalizedChatId);
  const query = useQuery({
    queryKey,
    queryFn: () => api.getState(normalizedChatId),
    enabled: Boolean(normalizedChatId),
    staleTime: 5_000,
  });

  const publish = async (state: RoleplayWorldTickState) => {
    queryClient.setQueryData(queryKey, state);
    await queryClient.invalidateQueries({ queryKey: chatKeys.detail(normalizedChatId) });
    return state;
  };
  const reloadAfterError = (_data: unknown, error: unknown) => {
    if (!error) return;
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: chatKeys.detail(normalizedChatId) });
  };

  const propose = useMutation({
    mutationFn: (input: { elapsed: string; guidance?: string; replacePending?: boolean; offerId?: string | null }) =>
      api.propose(normalizedChatId, input),
    onSuccess: async (result) => {
      await publish(result.state);
      return result;
    },
    onSettled: reloadAfterError,
  });

  const command = useMutation({
    mutationFn: (input: { command: WorldTickCommand; expectedRevision?: number }) =>
      api.command(normalizedChatId, input.command, input.expectedRevision),
    onSuccess: async (state, input) => {
      await publish(state);
      // A discard can remove a message left by an interrupted apply.
      if (input.command.type === "discard_pending") {
        await queryClient.invalidateQueries({ queryKey: chatKeys.messages(normalizedChatId) });
      }
    },
    onSettled: reloadAfterError,
  });

  const apply = useMutation({
    mutationFn: (input: { tickId: string; expectedRevision?: number }) =>
      api.apply(normalizedChatId, input.tickId, input.expectedRevision),
    onSuccess: async (state) => {
      await publish(state);
      await queryClient.invalidateQueries({ queryKey: chatKeys.messages(normalizedChatId) });
    },
    onSettled: (_data, error) => {
      reloadAfterError(_data, error);
      // A failed apply may still have changed the chat (or rolled a message back).
      if (error) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(normalizedChatId) });
    },
  });

  return {
    state: query.data,
    isLoading: query.isLoading,
    error: query.error,
    propose,
    command,
    apply,
  };
}
