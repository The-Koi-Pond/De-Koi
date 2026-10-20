import { useQuery } from "@tanstack/react-query";
import { storageApi } from "../../../../shared/api/storage-api";
import { chatKeys } from "../query-keys";
import { MEMORY_CAPTURE_LOG_FIELDS, MEMORY_CAPTURE_LOG_LIMIT, memoryCaptureLog } from "../lib/memory-capture-log";

// The newest capture jobs of one chat, read for the Memory Console's capture log.
export function useMemoryCaptureLog(chatId: string | null, enabled = true) {
  return useQuery({
    queryKey: chatKeys.memoryCaptureLog(chatId ?? ""),
    queryFn: async () =>
      memoryCaptureLog(
        await storageApi.list<unknown>("memory-capture-jobs", {
          filters: { chatId },
          orderBy: "createdAt",
          descending: true,
          limit: MEMORY_CAPTURE_LOG_LIMIT,
          fields: MEMORY_CAPTURE_LOG_FIELDS,
        }),
      ),
    enabled: !!chatId && enabled,
    staleTime: 10_000,
  });
}
