import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookMarked, ChevronDown, ChevronRight, Loader2, Pin, PinOff, RefreshCw, Save, XCircle } from "lucide-react";
import { toast } from "sonner";

import type { CanonicalMemoryRecord, StoryProjectionJob, StoryProjectionPayload } from "../../../../../../engine/contracts/types/memory";
import { Modal } from "../../../../../../shared/components/ui/Modal";
import { showConfirmDialog } from "../../../../../../shared/lib/app-dialogs";
import { cn } from "../../../../../../shared/lib/utils";
import { storyContinuityApi } from "../../../../../../shared/api/story-continuity-api";

export const storyContinuityQueryKey = (chatId: string) => ["story-continuity", chatId] as const;

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusTone(status: string): string {
  if (status === "active" || status === "pinned" || status === "completed") return "bg-emerald-500/12 text-emerald-300 ring-emerald-500/25";
  if (status === "stale" || status === "failed") return "bg-amber-500/12 text-amber-300 ring-amber-500/25";
  return "bg-sky-500/12 text-sky-300 ring-sky-500/25";
}

const SECTION_LABELS: Array<[keyof StoryProjectionPayload["sections"], string]> = [
  ["events", "Events"], ["choices", "Choices"], ["relationshipShifts", "Relationship shifts"],
  ["promises", "Promises"], ["reveals", "Reveals"], ["unresolvedHooks", "Unresolved hooks"],
  ["currentState", "Current state"],
];

export function StoryContinuityModal({ chatId, open, onClose }: { chatId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const query = useQuery({
    queryKey: storyContinuityQueryKey(chatId),
    queryFn: () => storyContinuityApi.getState(chatId),
    enabled: open,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: storyContinuityQueryKey(chatId) });
  const action = useMutation({
    mutationFn: async (input:
      | { type: "close" | "build" }
      | { type: "edit"; memory: CanonicalMemoryRecord; content: string }
      | { type: "pin" | "unpin" | "supersede" | "regenerate"; memory: CanonicalMemoryRecord }
      | { type: "retry"; job: StoryProjectionJob }) => {
      if (input.type === "close") return storyContinuityApi.closeEpisode(chatId);
      if (input.type === "build") return storyContinuityApi.buildExistingStory(chatId);
      if (input.type === "edit") return storyContinuityApi.edit(input.memory.id, input.content);
      if (input.type === "pin" || input.type === "unpin") return storyContinuityApi.setPinned(input.memory, input.type === "pin");
      if (input.type === "supersede") return storyContinuityApi.supersede(input.memory);
      if (input.type === "regenerate") return storyContinuityApi.regenerate(chatId, input.memory);
      if (input.type === "retry") return storyContinuityApi.retry(input.job);
      throw new Error("Unsupported story continuity action");
    },
    onSuccess: async (_result, input) => {
      setEditing(null);
      await refresh();
      toast.success(input.type === "build" ? "Existing story build finished." : "Story continuity updated.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Story continuity action failed."),
  });
  const counts = useMemo(() => {
    const projections = query.data?.projections ?? [];
    const jobs = query.data?.jobs ?? [];
    return {
      episodes: projections.filter((memory) => (memory.payload as StoryProjectionPayload).level === "episode" && (memory.status === "active" || memory.status === "pinned")).length,
      arcs: projections.filter((memory) => (memory.payload as StoryProjectionPayload).level === "arc" && (memory.status === "active" || memory.status === "pinned")).length,
      stale: projections.filter((memory) => memory.status === "stale").length,
      pending: jobs.filter((job) => job.status === "pending" || job.status === "processing" || job.status === "retryable").length,
    };
  }, [query.data]);

  return (
    <Modal open={open} onClose={onClose} title="Story Continuity" width="max-w-5xl">
      <div className="flex max-h-[78vh] flex-col gap-4 overflow-hidden">
        <div className="rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--primary)]/12 via-[var(--card)] to-[var(--card)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><BookMarked size="1rem" className="text-[var(--primary)]" /> Durable story structure</div>
              <p className="mt-1 max-w-2xl text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">Episodes and arcs are source-linked narrative projections. Recent transcript and canonical atomic memories remain authoritative.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={action.isPending} onClick={() => action.mutate({ type: "close" })} className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-[0.6875rem] font-medium hover:bg-[var(--accent)] disabled:opacity-50">Close episode</button>
              <button type="button" disabled={action.isPending} onClick={() => action.mutate({ type: "build" })} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-[0.6875rem] font-semibold text-[var(--primary-foreground)] disabled:opacity-50">{action.isPending ? "Working…" : "Build existing story"}</button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {Object.entries(counts).map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--background)]/55 px-3 py-2 ring-1 ring-[var(--border)]"><div className="text-base font-semibold">{value}</div><div className="text-[0.5625rem] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</div></div>)}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {query.isLoading && <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--muted-foreground)]"><Loader2 className="animate-spin" size="1rem" />Loading story…</div>}
          {query.error && <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">{query.error instanceof Error ? query.error.message : "Could not load story continuity."}</div>}
          {!query.isLoading && (query.data?.projections.length ?? 0) === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-12 text-center text-xs text-[var(--muted-foreground)]">No episodes yet. Keep roleplaying, close the current episode, or build existing story.</div>}
          <div className="space-y-2">
            {query.data?.projections.map((memory) => {
              const story = memory.payload as StoryProjectionPayload;
              const isExpanded = expanded === memory.id;
              const liveById = new Map((query.data?.messages ?? []).map((message) => [String(message.id), message]));
              const projectionById = new Map((query.data?.projections ?? []).map((projection) => [projection.id, projection]));
              return <article key={memory.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70">
                <button type="button" onClick={() => setExpanded(isExpanded ? null : memory.id)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-3 text-left">
                  <span className="mt-0.5 text-[var(--muted-foreground)]">{isExpanded ? <ChevronDown size="0.875rem" /> : <ChevronRight size="0.875rem" />}</span>
                  <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-xs font-semibold">{memory.title || (story.level === "episode" ? "Episode" : "Arc")}</span><span className={cn("rounded-full px-1.5 py-0.5 text-[0.5rem] uppercase tracking-wide ring-1", statusTone(memory.status))}>{memory.status}</span><span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.5rem] uppercase tracking-wide text-[var(--muted-foreground)]">{story.level}</span></span><span className="mt-1 line-clamp-2 block text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">{memory.content}</span></span>
                  <span className="text-[0.5625rem] text-[var(--muted-foreground)]">{dateLabel(memory.createdAt)}</span>
                </button>
                {isExpanded && <div className="border-t border-[var(--border)] p-3">
                  {editing === memory.id ? <div className="space-y-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-28 w-full rounded-lg border border-[var(--input)] bg-[var(--background)] p-2 text-xs outline-none focus:ring-1 focus:ring-[var(--ring)]" /><div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)]">Cancel</button><button disabled={!draft.trim() || action.isPending} onClick={() => action.mutate({ type: "edit", memory, content: draft })} className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-2 py-1 text-[0.625rem] text-[var(--primary-foreground)]"><Save size="0.625rem" />Save</button></div></div> : <p className="whitespace-pre-wrap text-xs leading-relaxed">{memory.content}</p>}
                  <div className="mt-3 grid gap-2 md:grid-cols-2">{SECTION_LABELS.map(([key, label]) => story.sections[key]?.length ? <section key={key} className="rounded-lg bg-[var(--secondary)]/55 p-2"><h4 className="text-[0.5625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</h4><ul className="mt-1 space-y-1 text-[0.625rem]">{story.sections[key].map((item, index) => <li key={index}>• {item.text}</li>)}</ul></section> : null)}</div>
                  <details className="mt-3 rounded-lg bg-[var(--background)]/55 p-2 ring-1 ring-[var(--border)]"><summary className="cursor-pointer text-[0.625rem] font-medium">Exact sources · {story.messageIds.length} messages{story.sourceEpisodeIds.length ? ` · ${story.sourceEpisodeIds.length} episodes` : ""}</summary><div className="mt-2 max-h-52 space-y-2 overflow-y-auto">{story.sourceEpisodeIds.map((id) => { const source = projectionById.get(id); return <div key={id} className="rounded bg-[var(--secondary)]/60 p-2 text-[0.5625rem]"><div className="font-mono text-[var(--muted-foreground)]">{id} {!source && <span className="text-amber-300">· source missing</span>}</div><div className="mt-1 font-medium">{source?.title ?? "Unavailable"}</div>{source && <div className="mt-1 whitespace-pre-wrap">{source.content}</div>}</div>; })}{story.messageIds.map((id) => { const saved = story.sourceMessages?.find((message) => message.id === id); const live = liveById.get(id); return <div key={id} className="rounded bg-[var(--secondary)]/60 p-2 text-[0.5625rem]"><div className="font-mono text-[var(--muted-foreground)]">{id} {!live && <span className="text-amber-300">· source missing</span>}</div><div className="mt-1 whitespace-pre-wrap">{String(live?.content ?? saved?.content ?? "Unavailable")}</div></div>; })}</div></details>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => { setEditing(memory.id); setDraft(memory.content); }} className="rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem]">Edit</button>
                    {story.level === "episode" && <button disabled={action.isPending} onClick={() => action.mutate({ type: "regenerate", memory })} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem]"><RefreshCw size="0.625rem" />Regenerate</button>}
                    {(memory.status === "active" || memory.status === "pinned") && <button disabled={action.isPending} onClick={() => action.mutate({ type: memory.status === "pinned" ? "unpin" : "pin", memory })} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem]">{memory.status === "pinned" ? <PinOff size="0.625rem" /> : <Pin size="0.625rem" />}{memory.status === "pinned" ? "Unpin" : "Pin"}</button>}
                    {(memory.status === "active" || memory.status === "pinned") && <button disabled={action.isPending} onClick={async () => { if (await showConfirmDialog({ title: "Supersede this projection?", message: "It will stop appearing in prompts. Dependent arcs will become stale.", confirmLabel: "Supersede", tone: "destructive" })) action.mutate({ type: "supersede", memory }); }} className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-1 text-[0.625rem] text-amber-300"><XCircle size="0.625rem" />Supersede</button>}
                  </div>
                </div>}
              </article>;
            })}
          </div>

          {(query.data?.jobs.some((job) => job.status !== "completed") ?? false) && <section className="mt-4"><h3 className="mb-2 text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Background jobs</h3><div className="space-y-2">{query.data?.jobs.filter((job) => job.status !== "completed").map((job) => <div key={job.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/45 p-2"><AlertTriangle size="0.75rem" className={job.status === "failed" ? "text-amber-300" : "text-sky-300"} /><div className="min-w-0 flex-1"><div className="text-[0.625rem] font-medium">{job.level} · {job.status}</div><div className="truncate text-[0.5625rem] text-[var(--muted-foreground)]">{String(job.lastError ?? `${job.sourceMessageIds.length} source messages`)}</div></div>{(job.status === "failed" || job.status === "retryable") && <button disabled={action.isPending} onClick={() => action.mutate({ type: "retry", job })} className="rounded-md border border-[var(--border)] px-2 py-1 text-[0.5625rem]">Retry</button>}</div>)}</div></section>}
        </div>
      </div>
    </Modal>
  );
}
