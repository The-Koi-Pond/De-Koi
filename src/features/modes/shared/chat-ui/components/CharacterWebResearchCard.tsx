import { useState } from "react";
import { Globe2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { CharacterWebResearchRequest } from "../../../../../engine/contracts/types/chat";
import { storageApi } from "../../../../../shared/api/storage-api";
import { chatKeys } from "../../../../catalog/chats";

export function CharacterWebResearchCard({
  chatId,
  messageId,
  request,
  onRegenerate,
}: {
  chatId: string;
  messageId: string;
  request: CharacterWebResearchRequest;
  onRegenerate?: (messageId: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (request.status && request.status !== "pending") {
    return <p className="mt-2 text-xs text-[var(--muted-foreground)]">Web research {request.status}.</p>;
  }

  const decide = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    const status = approve ? "approved" : "declined";
    try {
      if (approve) {
        const now = new Date();
        await storageApi.patchChatMetadata(chatId, {
          characterWebResearchGrant: {
            id: `character-web-${crypto.randomUUID()}`,
            query: request.query,
            allowedDomains: request.allowedDomains,
            requestMessageId: messageId,
            grantedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          },
        });
      }
      await storageApi.patchChatMessageExtra(messageId, {
        characterWebResearchRequest: { ...request, status },
      });
      await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
      if (approve) onRegenerate?.(messageId);
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
      <div className="mt-2 flex gap-2">
        <button
          className="rounded px-2 py-1 text-xs hover:bg-black/10"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          Not now
        </button>
        <button
          className="rounded bg-sky-500 px-2 py-1 text-xs text-white hover:bg-sky-400 disabled:opacity-60"
          disabled={busy || !onRegenerate}
          onClick={() => void decide(true)}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Allow once"}
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
