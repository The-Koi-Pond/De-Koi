import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { PROVIDERS } from "../../../../engine/contracts/constants/providers";
import { storageApi } from "../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useCreateConnection, useDeleteConnection } from "../../../catalog/connections";

/**
 * The OpenRouter connection behind the first-run "Log in with OpenRouter" card. It is created when the login
 * starts (the login needs a connection to save into), reused if the user retries, and removed again if they
 * back out before a key was saved, so a cancelled login doesn't leave an empty connection behind.
 */
export function useOpenRouterStarterConnection() {
  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  // Keeps the card on screen once the new connection makes the panel stop looking empty.
  const [active, setActive] = useState(false);
  const createdIdRef = useRef<string | null>(null);

  const prepare = useCallback(async (): Promise<string | null> => {
    setActive(true);
    if (createdIdRef.current) return createdIdRef.current;
    const result = await createConnection.mutateAsync({
      name: PROVIDERS.openrouter.name,
      provider: "openrouter",
      baseUrl: PROVIDERS.openrouter.defaultBaseUrl,
      apiKey: "",
      model: "",
      maxContext: 128000,
    });
    const id = (result as { id?: string } | null)?.id ?? null;
    createdIdRef.current = id;
    return id;
  }, [createConnection]);

  const cancel = useCallback(async () => {
    const id = createdIdRef.current;
    createdIdRef.current = null;
    setActive(false);
    if (!id) return;
    try {
      const connection = await storageApi.get<{ hasApiKey?: boolean }>("connections", id);
      if (connection && connection.hasApiKey !== true) await deleteConnection.mutateAsync(id);
    } catch (error) {
      toast.error(
        toUserMessage(error, {
          fallback: "Couldn't remove the empty OpenRouter connection. Delete it from the Connections list.",
        }),
      );
    }
  }, [deleteConnection]);

  return { active, prepare, cancel };
}
