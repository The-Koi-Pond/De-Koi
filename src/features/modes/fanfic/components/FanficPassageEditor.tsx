import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, Square, TextSelect, X } from "lucide-react";
import { chatKeys } from "../../../catalog/chats/index";
import {
  applyFanficPassageRewrite,
  suggestFanficPassageRewrite,
  type FanficPassageSuggestion,
} from "../../../../engine/modes/fanfic/passage";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { cn } from "../../../../shared/lib/utils";
import { FanficButton, fanficInputClass } from "./fanfic-ui";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Rewrites one passage the requester selected: say what's wrong, get a version, ask for more, and pick one. Every
 * version stays listed until the editor closes; the one used is saved as a new version of the chapter.
 */
export function FanficPassageEditor({
  chatId,
  messageId,
  chapterNumber,
  textKey,
  selected,
  busy,
  onClose,
}: {
  chatId: string;
  messageId: string;
  chapterNumber: number;
  /** Fingerprint of the chapter text the selection was made in. */
  textKey: string;
  selected: string;
  busy: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<FanficPassageSuggestion[]>([]);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const write = () => {
    if (controllerRef.current || !note.trim()) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    void suggestFanficPassageRewrite(
      { storage: storageApi, llm: llmApi },
      {
        chatId,
        messageId,
        textKey,
        selected,
        instruction: note,
        earlierTries: versions.map((version) => version.text),
      },
      { signal: controller.signal },
    )
      .then((suggestion) => setVersions((current) => [...current, suggestion]))
      .catch((error: unknown) => {
        if (!isAbort(error)) toast.error(error instanceof Error ? error.message : "The rewrite failed.");
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        setRunning(false);
      });
  };

  const use = async (index: number) => {
    const suggestion = versions[index];
    if (!suggestion) return;
    setApplying(index);
    try {
      await applyFanficPassageRewrite(storageApi, { chatId, messageId, textKey, suggestion });
      await queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
      toast.success(
        `Passage replaced. Chapter ${chapterNumber} saved as a new version, so the old one is one tap back.`,
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The passage could not be replaced.");
    } finally {
      setApplying(null);
    }
  };

  return (
    <section
      aria-label="Rewrite a passage"
      className="flex flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">
          <TextSelect size="0.9rem" className="mr-1 inline" aria-hidden="true" />
          Rewrite a passage
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the passage editor"
          className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <X size="0.9rem" aria-hidden="true" />
        </button>
      </div>
      <blockquote className="max-h-40 overflow-y-auto border-l-2 border-[var(--border)] pl-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
        {selected}
      </blockquote>
      <label htmlFor={`fanfic-passage-note-${messageId}`} className="text-xs text-[var(--muted-foreground)]">
        What's wrong with it?
      </label>
      <textarea
        id={`fanfic-passage-note-${messageId}`}
        rows={2}
        className={cn(fanficInputClass, "resize-y text-[0.8125rem]")}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="He'd never say this so softly. Make it a threat he enjoys."
      />
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <>
            <p className="text-[0.8125rem] text-[var(--foreground)]" role="status">
              <Loader2 size="0.85rem" className="mr-1 inline animate-spin" aria-hidden="true" />
              Rewriting the passage…
            </p>
            <FanficButton onClick={() => controllerRef.current?.abort()}>
              <Square size="0.8rem" aria-hidden="true" />
              Stop
            </FanficButton>
          </>
        ) : (
          <FanficButton
            tone={versions.length === 0 ? "primary" : undefined}
            disabled={busy || !note.trim()}
            onClick={write}
          >
            <RefreshCw size="0.85rem" aria-hidden="true" />
            {versions.length === 0 ? "Rewrite it" : "Try another version"}
          </FanficButton>
        )}
      </div>
      {versions.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Versions">
          {versions.map((version, index) => (
            <li
              key={`${index}-${version.text.slice(0, 24)}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5"
            >
              <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Version {index + 1}
              </p>
              <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-[var(--foreground)]">
                {version.text}
              </p>
              <FanficButton
                className="mt-2"
                tone="primary"
                disabled={busy || running || applying !== null}
                onClick={() => void use(index)}
              >
                {applying === index ? (
                  <Loader2 size="0.85rem" className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check size="0.85rem" aria-hidden="true" />
                )}
                Use this version
              </FanficButton>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
        Only the selected passage changes. Every version stays here until you close this, and the one you use is saved
        as a new version of the chapter.
      </p>
    </section>
  );
}
