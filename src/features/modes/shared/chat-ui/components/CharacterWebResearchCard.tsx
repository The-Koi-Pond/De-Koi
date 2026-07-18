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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<CharacterWebResearchRequest["status"] | null>(null);
  const resolvedStatus = request.status && request.status !== "pending" ? request.status : localStatus;

  useEffect(() => {
    setLocalStatus(null);
    setError(null);
  }, [messageId, request.query, request.status]);

  if (resolvedStatus && resolvedStatus !== "pending") {
    return <p className="mt-2 text-xs text-[var(--muted-foreground)]">Web research {resolvedStatus}.</p>;
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
      await storageApi.patchChatMetadata(chatId, characterWebResearchApprovalPatch(approval, grant));
      await onRegenerate?.(messageId, { propagateErrors: true, skipTouchConfirm: true });
      setError(null);
      await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    } catch (cause) {
      setError(toUserMessage(cause, "characterWebResearchRetry"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-2 rounded-lg border border-sky-400/30 bg-sky-500/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Globe2 className="h-4 w-4" />
        Allow this character to research the web?
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{request.reason}</p>
      <p className="mt-2 rounded bg-black/10 px-2 py-1 text-xs">{request.query}</p>
      {request.allowedDomains.length > 0 && (
        <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">
          Limited to: {request.allowedDomains.join(", ")}
        </p>
      )}
      {error && <div className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{error}</div>}
      <div className="mt-2 flex gap-2">
        <button
          className="rounded px-2 py-1 text-xs hover:bg-black/10"
          disabled={busy}
          onClick={() => void decide("decline")}
        >
          Not now
        </button>
        <button
          className="rounded bg-sky-500 px-2 py-1 text-xs text-white hover:bg-sky-400 disabled:opacity-60"
          disabled={busy || !onRegenerate}
          onClick={() => void decide("once")}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Allow once"}
        </button>
        <button
          className="rounded border border-sky-400/50 px-2 py-1 text-xs text-sky-600 hover:bg-sky-500/10 disabled:opacity-60 dark:text-sky-300"
          disabled={busy || !onRegenerate}
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
    <section className="mt-2 text-xs text-[var(--muted-foreground)]">
      <span className="font-medium">Sources:</span>{" "}
      {sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 ? " · " : ""}
          <a className="underline hover:text-[var(--foreground)]" href={source.url} target="_blank" rel="noreferrer">
            {source.title || new URL(source.url).hostname}
          </a>
        </span>
      ))}
    </section>
  );
}
