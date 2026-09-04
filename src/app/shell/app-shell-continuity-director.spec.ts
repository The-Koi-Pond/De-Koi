import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

import { chatKeys } from "../../features/catalog/chats";
import { publishContinuityDirectorRefreshCompletion } from "../../engine/modes/roleplay/continuity-director/continuity-director-refresh-events";
import { roleplayContinuityDirectorKeys } from "../../shared/api/roleplay-continuity-director-query-keys";
import {
  invalidateContinuityDirectorRefreshCompletion,
  subscribeContinuityDirectorRefreshCacheInvalidation,
} from "./app-shell-continuity-director";

it("reconciles Director and chat caches after an automatic refresh completes", async () => {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

  await invalidateContinuityDirectorRefreshCompletion(queryClient, "chat-1");

  expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayContinuityDirectorKeys.state("chat-1") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.detail("chat-1") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list() });
  expect(invalidate).toHaveBeenCalledTimes(3);
});

it("wires automatic refresh completion events to cache invalidation until unsubscribed", async () => {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  const unsubscribe = subscribeContinuityDirectorRefreshCacheInvalidation(queryClient);

  publishContinuityDirectorRefreshCompletion({ chatId: "chat-2" });

  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayContinuityDirectorKeys.state("chat-2") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.detail("chat-2") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list() });

  unsubscribe();
  invalidate.mockClear();
  publishContinuityDirectorRefreshCompletion({ chatId: "chat-3" });
  await Promise.resolve();

  expect(invalidate).not.toHaveBeenCalled();
});
