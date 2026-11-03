import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, RefreshCw, Reply, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { Chat, Message } from "../../../../engine/contracts/types/chat";
import { FANFIC_COMMENT_MAX_CHARS, readFanficCommentThread } from "../../../../engine/modes/fanfic/comments";
import { readString } from "../../../../engine/generation/runtime-records";
import { fanficChapterTextKey } from "../../../../engine/modes/fanfic/ledger";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { applyInlineMarkdown } from "../../../../shared/lib/markdown";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { cn } from "../../../../shared/lib/utils";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useChatMessages, useSetActiveSwipe } from "../../../catalog/chats/index";
import { useConnection } from "../../../catalog/connections/index";
import { GenerationFailureNotice, isReportedGenerationFailure } from "../../../runtime/generation/index";
import {
  chapterCommentThreads,
  useFanficCommentActions,
  useFanficCommentThreads,
  useRefreshFanficCommentsOnReturn,
} from "../hooks/use-fanfic-comments";
import { FanficButton, fanficInputClass } from "./fanfic-ui";

type CommentActions = ReturnType<typeof useFanficCommentActions>;

function reportSendFailure(error: unknown): void {
  // The reply pipeline already shows its own failures (under the thread); a Stop needs no message.
  if (isReportedGenerationFailure(error) || (error instanceof Error && error.name === "AbortError")) return;
  toast.error(toUserMessage(error, { fallback: "Couldn't post the comment. Try again." }));
}

function commentTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A comment's text: paragraphs, line breaks and inline markdown (bold, italics), as React text, never HTML. */
function CommentText({ text, keyBase }: { text: string; keyBase: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={`${keyBase}-${index}`} className="mb-[0.7em] last:mb-0">
          {paragraph
            .split("\n")
            .flatMap((line, lineIndex) => [
              lineIndex > 0 ? <br key={`${keyBase}-${index}-br-${lineIndex}`} /> : null,
              ...applyInlineMarkdown(line, `${keyBase}-${index}-${lineIndex}`),
            ])}
        </p>
      ))}
    </>
  );
}

/** The box a comment is typed into. The text stays until the comment is saved, so a failed send loses nothing. */
function CommentBox({
  id,
  label,
  placeholder,
  submitLabel,
  disabled,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  id: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  disabled: boolean;
  autoFocus?: boolean;
  onSubmit: (text: string, accepted: () => void) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onSubmit(text, () => setText(""));
    } catch (error) {
      reportSendFailure(error);
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        className={cn(fanficInputClass, "min-h-20 resize-y")}
        placeholder={placeholder}
        value={text}
        maxLength={FANFIC_COMMENT_MAX_CHARS}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <FanficButton onClick={onCancel}>Cancel</FanficButton>}
        <FanficButton type="submit" tone="primary" disabled={disabled || sending || !text.trim()}>
          {submitLabel}
        </FanficButton>
      </div>
    </form>
  );
}

/** One comment card, styled like AO3's: the author's replies carry an "Author" badge. */
function CommentCard({
  message,
  author,
  modelName,
  body,
  footer,
}: {
  message: Pick<Message, "createdAt">;
  author: boolean;
  modelName: string | null;
  body: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3",
        author ? "border-[var(--primary)]/35 bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--secondary)]/30",
      )}
      data-fanfic-comment={author ? "author" : "reader"}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">{author ? "The author" : "You"}</span>
        {author && (
          <span className="rounded border border-[var(--primary)]/50 px-1.5 py-px text-[0.625rem] font-bold uppercase tracking-wide text-[var(--primary)]">
            Author
          </span>
        )}
        {author && modelName && <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{modelName}</span>}
        <span className="ml-auto text-[0.6875rem] text-[var(--muted-foreground)]">
          {commentTime(message.createdAt)}
        </span>
      </div>
      <div className="break-words text-[0.875rem] leading-relaxed text-[var(--foreground)]">{body}</div>
      {footer && <div className="flex flex-wrap items-center gap-2">{footer}</div>}
    </li>
  );
}

/** A comment thread: its comments in order, the author's reply while it streams, and one reply box. */
function CommentThread({
  thread,
  chapterTextKey,
  actions,
}: {
  thread: Chat;
  chapterTextKey: string;
  actions: CommentActions;
}) {
  const threadId = thread.id;
  const meta = readFanficCommentThread(thread.metadata);
  // Page size 0 reads the whole thread; a thread is short.
  const messagesQuery = useChatMessages(threadId, 0);
  const messages = useMemo(
    () =>
      (messagesQuery.data?.pages.flat() ?? [])
        .filter((message) => message.role === "user" || message.role === "assistant")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messagesQuery.data],
  );
  const connection = useConnection(thread.connectionId ?? null);
  const connectionRecord = (connection.data ?? {}) as { name?: unknown; model?: unknown };
  const modelName = readString(connectionRecord.name).trim() || readString(connectionRecord.model).trim() || null;
  const replying = useChatStore((state) => state.abortControllers.has(threadId));
  const streamText = useChatStore((state) => state.streamBuffers.get(threadId) ?? "");
  const phase = useChatStore((state) => state.generationPhaseByChatId.get(threadId) ?? null);
  const redoing = useChatStore((state) => state.regenerateMessageIdByChatId.get(threadId) ?? null);
  const setSwipe = useSetActiveSwipe(threadId);
  const [replyOpen, setReplyOpen] = useState(false);
  const lastAuthorId = [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
  const last = messages[messages.length - 1];
  // A reader comment with no reply after it (a failed or stopped reply) can be answered again.
  const unanswered = last?.role === "user" && !replying;
  const earlierVersion = Boolean(meta?.textKey) && meta?.textKey !== chapterTextKey;

  const removeThread = async () => {
    const confirmed = await showConfirmDialog({
      title: "Delete thread",
      message: "Delete this comment thread and every reply in it? The chapter stays as it is.",
      confirmLabel: "Delete thread",
      tone: "destructive",
    });
    if (confirmed) actions.deleteThread.mutate(threadId);
  };

  if (messagesQuery.isLoading) return null;
  return (
    <div className="flex flex-col gap-2" aria-label="Comment thread" role="group">
      {earlierVersion && (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
          Started on an earlier version of this chapter.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {messages.map((message) => {
          const author = message.role === "assistant";
          const versions = message.swipeCount ?? 0;
          const shown = message.activeSwipeIndex ?? 0;
          if (author && replying && redoing === message.id) {
            return (
              <CommentCard
                key={message.id}
                message={message}
                author
                modelName={modelName}
                body={
                  streamText ? (
                    <CommentText text={streamText} keyBase={`${message.id}-stream`} />
                  ) : (
                    <span className="text-[var(--muted-foreground)]">{phase ?? "Writing a reply…"}</span>
                  )
                }
                footer={
                  <FanficButton onClick={() => actions.stop(threadId)}>
                    <Square size="0.8rem" aria-hidden="true" />
                    Stop
                  </FanficButton>
                }
              />
            );
          }
          return (
            <CommentCard
              key={message.id}
              message={message}
              author={author}
              modelName={modelName}
              body={<CommentText text={message.content} keyBase={message.id} />}
              footer={
                <>
                  <FanficButton disabled={replying} onClick={() => setReplyOpen(true)}>
                    <Reply size="0.85rem" aria-hidden="true" />
                    Reply
                  </FanficButton>
                  {author && message.id === lastAuthorId && (
                    <FanficButton
                      disabled={replying}
                      onClick={() => void actions.redo(threadId, message.id).catch(reportSendFailure)}
                    >
                      <RefreshCw size="0.85rem" aria-hidden="true" />
                      Redo reply
                    </FanficButton>
                  )}
                  {author && versions > 1 && (
                    <span className="inline-flex items-center gap-1 text-[0.75rem] text-[var(--muted-foreground)]">
                      <button
                        type="button"
                        aria-label="Previous version of this reply"
                        className="rounded p-1 hover:bg-[var(--accent)]/60 disabled:opacity-40"
                        disabled={replying || shown <= 0 || setSwipe.isPending}
                        onClick={() => setSwipe.mutate({ messageId: message.id, index: shown - 1 })}
                      >
                        <ChevronLeft size="0.9rem" aria-hidden="true" />
                      </button>
                      {shown + 1}/{versions}
                      <button
                        type="button"
                        aria-label="Next version of this reply"
                        className="rounded p-1 hover:bg-[var(--accent)]/60 disabled:opacity-40"
                        disabled={replying || shown >= versions - 1 || setSwipe.isPending}
                        onClick={() => setSwipe.mutate({ messageId: message.id, index: shown + 1 })}
                      >
                        <ChevronRight size="0.9rem" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </>
              }
            />
          );
        })}
        {replying && !redoing && (
          <CommentCard
            message={{ createdAt: new Date().toISOString() }}
            author
            modelName={modelName}
            body={
              streamText ? (
                <CommentText text={streamText} keyBase={`${threadId}-stream`} />
              ) : (
                <span className="text-[var(--muted-foreground)]">{phase ?? "Writing a reply…"}</span>
              )
            }
            footer={
              <FanficButton onClick={() => actions.stop(threadId)}>
                <Square size="0.8rem" aria-hidden="true" />
                Stop
              </FanficButton>
            }
          />
        )}
      </ol>
      <GenerationFailureNotice
        chatId={threadId}
        onRetry={() => void actions.answer(threadId).catch(reportSendFailure)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {unanswered && (
          <FanficButton onClick={() => void actions.answer(threadId).catch(reportSendFailure)}>
            <RefreshCw size="0.85rem" aria-hidden="true" />
            Get the author's reply
          </FanficButton>
        )}
        {!replyOpen && (
          <FanficButton disabled={replying} onClick={() => setReplyOpen(true)}>
            <Reply size="0.85rem" aria-hidden="true" />
            Reply
          </FanficButton>
        )}
        <FanficButton
          tone="danger"
          disabled={replying || actions.deleteThread.isPending}
          onClick={() => void removeThread()}
        >
          <Trash2 size="0.85rem" aria-hidden="true" />
          Delete thread
        </FanficButton>
      </div>
      {replyOpen && (
        <CommentBox
          id={`fanfic-comment-reply-${threadId}`}
          label="Reply to this thread"
          placeholder="Reply…"
          submitLabel="Reply"
          disabled={replying}
          autoFocus
          onCancel={() => setReplyOpen(false)}
          onSubmit={async (text, accepted) => {
            await actions.comment({
              chapterMessageId: meta?.chapterMessageId ?? "",
              threadId,
              text,
              onAccepted: () => {
                accepted();
                setReplyOpen(false);
              },
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * The comments under a chapter, like AO3's: a box for a new comment, then each thread. The author (the model that
 * wrote the chapter) answers each comment with the request, the outline, the story so far and this chapter in mind.
 */
export function FanficComments({
  ficChatId,
  chapterMessageId,
  chapterLabel,
  chapterContent,
  disabled,
}: {
  ficChatId: string;
  chapterMessageId: string;
  chapterLabel: string;
  chapterContent: string;
  /** While the fic itself is writing, so a comment doesn't race the chapter it is about. */
  disabled: boolean;
}) {
  const threadsQuery = useFanficCommentThreads(ficChatId);
  const threads = chapterCommentThreads(threadsQuery.data, chapterMessageId);
  const actions = useFanficCommentActions(ficChatId);
  useRefreshFanficCommentsOnReturn(
    ficChatId,
    threads.map((thread) => thread.id),
  );
  const chapterTextKey = useMemo(
    () => fanficChapterTextKey(stripFanficChapterHeading(chapterContent)),
    [chapterContent],
  );
  const [open, setOpen] = useState(false);
  const shown = open || threads.length > 0;
  return (
    <section
      aria-label={`Comments on chapter ${chapterLabel}`}
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-[var(--foreground)]">
          <MessageSquare size="0.95rem" aria-hidden="true" />
          Comments{threads.length > 0 ? ` (${threads.length})` : ""}
        </h3>
        {!shown && (
          <FanficButton className="ml-auto" onClick={() => setOpen(true)}>
            Comment on this chapter
          </FanficButton>
        )}
      </div>
      {shown && (
        <>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Talk the chapter over with the author: what you liked, what you didn't, where the story could go instead.
            Nothing here changes the fic.
          </p>
          {threads.map((thread) => (
            <CommentThread key={thread.id} thread={thread} chapterTextKey={chapterTextKey} actions={actions} />
          ))}
          <CommentBox
            id={`fanfic-comment-new-${chapterMessageId}`}
            label={`Comment on chapter ${chapterLabel}`}
            placeholder={threads.length > 0 ? "Start a new thread…" : "Leave a comment…"}
            submitLabel="Post comment"
            disabled={disabled}
            autoFocus={open && threads.length === 0}
            onSubmit={(text, accepted) =>
              actions.comment({ chapterMessageId, threadId: null, text, onAccepted: accepted })
            }
          />
        </>
      )}
    </section>
  );
}
