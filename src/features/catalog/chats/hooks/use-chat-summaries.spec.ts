import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  CHAT_SUMMARY_SESSION_STALE_TIME_MS,
  useChatSummaries,
  useRecentChatSummaries,
} from "./use-chat-summaries";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((options) => options),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    list: vi.fn(),
  },
}));

describe("chat summary query policy", () => {
  it("keeps full chat summaries warm and avoids passive focus reconnect refetches", () => {
    const options = useChatSummaries() as unknown as Record<string, unknown>;

    expect(options.staleTime).toBe(CHAT_SUMMARY_SESSION_STALE_TIME_MS);
    expect(options.gcTime).toBeGreaterThanOrEqual(CHAT_SUMMARY_SESSION_STALE_TIME_MS);
    expect(options.refetchOnMount).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
    expect(useQuery).toHaveBeenCalledTimes(1);
  });

  it("uses the same calm refetch policy for recent chat summaries", () => {
    const options = useRecentChatSummaries(5) as unknown as Record<string, unknown>;

    expect(options.staleTime).toBe(CHAT_SUMMARY_SESSION_STALE_TIME_MS);
    expect(options.gcTime).toBeGreaterThanOrEqual(CHAT_SUMMARY_SESSION_STALE_TIME_MS);
    expect(options.refetchOnMount).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
  });
});
