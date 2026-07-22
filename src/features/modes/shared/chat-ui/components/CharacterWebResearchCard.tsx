import { useEffect, useState } from "react";
import { Globe2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { CharacterWebResearchRequest } from "../../../../../engine/contracts/types/chat";
import {
  characterWebResearchApprovalPatch,
  createCharacterWebResearchGrant,
  type CharacterWebResearchApproval,
} from "../../../../../engine/generation/character-web-research";
import { storageApi } from "../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { chatKeys } from "../../../../catalog/chats";
import type { RegenerateOptions } from "../types";

export function CharacterWebResearchCard({
  chatId,
  messageId,
  request,
  onRegenerate,
}: {
  chatId: string;
  messageId: string;
  request: CharacterWebResearchRequest;
  onRegenerate?: (messageId: string, options?: RegenerateOptions) => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const generationBusy = useChatStore((state) => state.isStreaming && state.streamingChatId === chatId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<CharacterWebResearchRequest["status"] | null>(null);
  const resolvedStatus = localStatus ?? request.status ?? "pending";

  useEffect(() => {
    setLocalStatus(null);
    setError(null);
  }, [messageId, request.query, request.status]);

  if (resolvedStatus === "completed" || resolvedStatus === "declined" || resolvedStatus === "approved") {
    return <p className="mt-2 text-xs text-[var(--muted-foreground)]">Web research {resolvedStatus}.</p>;
  }

  if (resolvedStatus === "researching") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Web research in progress...
      </p>
    );
  }

  const decide = async (approval: CharacterWebResearchApproval | "decline") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (approval === "decline") {
        await storageApi.patchChatMessageExtra(messageId, {
          characterWebResearchRequest: { ...request, status: "declined" },
        });
        setLocalStatus("declined");
        await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        return;
      }

      const grant = createCharacterWebResearchGrant({
        query: request.query,
        allowedDomains: request.allowedDomains,
        requestMessageId: messageId,
      });
      await storageApi.patchChatMessageExtra(messageId, {
        characterWebResearchRequest: { ...request, status: "researching", failureMessage: null },
      });
      setLocalStatus("researching");
      await storageApi.patchChatMetadata(chatId, characterWebResearchApprovalPatch(approval, grant));
      await onRegenerate?.(messageId, { chatId, propagateErrors: true, skipTouchConfirm: true });
      await storageApi.patchChatMessageExtra(messageId, {
        characterWebResearchRequest: { ...request, status: "completed", failureMessage: null },
      });
      setLocalStatus("completed");
      setError(null);
      await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    } catch (cause) {
      const failureMessage = toUserMessage(cause, "characterWebResearchRetry");
      await storageApi.patchChatMessageExtra(messageId, {
        characterWebResearchRequest: { ...request, status: "failed", failureMessage },
      });
      await storageApi.patchChatMetadata(chatId, { characterWebResearchGrant: null });
      setLocalStatus("failed");
      setError(failureMessage);
      await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-2 rounded-lg border border-sky-400/30 bg-sky-500/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Globe2 className="h-4 w-4" />
        {resolvedStatus === "failed" ? "Web research failed" : "Allow this character to research the web?"}
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{request.reason}</p>
      <p className="mt-2 rounded bg-black/10 px-2 py-1 text-xs">{request.query}</p>
      {request.allowedDomains.length > 0 && (
        <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">
          Limited to: {request.allowedDomains.join(", ")}
        </p>
      )}
      {(error || request.failureMessage) && (
        <div className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
          {error || request.failureMessage}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button
          className="rounded px-2 py-1 text-xs hover:bg-black/10"
          disabled={busy || generationBusy}
          onClick={() => void decide("decline")}
        >
          Not now
        </button>
        <button
          className="rounded bg-sky-500 px-2 py-1 text-xs text-white hover:bg-sky-400 disabled:opacity-60"
          disabled={busy || generationBusy || !onRegenerate}
          onClick={() => void decide("once")}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Allow once"}
        </button>
        <button
          className="rounded border border-sky-400/50 px-2 py-1 text-xs text-sky-600 hover:bg-sky-500/10 disabled:opacity-60 dark:text-sky-300"
          disabled={busy || generationBusy || !onRegenerate}
          onClick={() => void decide("always")}
        >
          Always allow
        </button>
      </div>
    </section>
  );
}

export function CharacterWebResearchSources({ sources }: { sources?: Array<{ title: string; url: string }> | null }) {
  if (!sources?.length) return null;
  return (
    <details className="group mt-2 text-xs text-[var(--muted-foreground)]">
      <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 font-medium transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]">
        Sources
        <span className="rounded-full bg-[var(--secondary)] px-1.5 text-[0.625rem] font-normal">{sources.length}</span>
      </summary>
      <div className="mt-1.5 space-y-1 border-l border-[var(--border)] pl-3">
        {sources.map((source) => (
          <a
            className="block w-fit max-w-full truncate underline decoration-[var(--border)] underline-offset-2 transition-colors hover:text-[var(--foreground)]"
            href={source.url}
            key={source.url}
            rel="noreferrer"
            target="_blank"
          >
            {source.title || new URL(source.url).hostname}
          </a>
        ))}
      </div>
    </details>
  );
}
