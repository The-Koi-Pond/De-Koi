import { AlertTriangle, Check, Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { KnowledgeHolderKind, KnowledgeStance } from "../../../../engine/contracts/types/memory";
import { useKnowledgeEdgeActions, useKnowledgeEdges, useKnowledgeHolders } from "../hooks/use-knowledge-edges";

const STANCES: KnowledgeStance[] = ["knows", "believes", "suspects", "disbelieves", "unknown"];

export function KnowledgeEdgeEditor({ memoryId }: { memoryId: string }) {
  const edges = useKnowledgeEdges(memoryId);
  const holders = useKnowledgeHolders(!edges.isError);
  const actions = useKnowledgeEdgeActions(memoryId);
  const [holderKey, setHolderKey] = useState("world:world");
  const [stance, setStance] = useState<KnowledgeStance>("knows");
  const [confidence, setConfidence] = useState("");
  const activeOrInvalidated = (edges.data ?? []).some((edge) => edge.status !== "proposed");
  const holderLabels = useMemo(
    () => new Map((holders.data ?? []).map((holder) => [`${holder.kind}:${holder.id}`, holder.name])),
    [holders.data],
  );

  if (edges.isLoading) return <div className="text-xs text-[var(--muted-foreground)]">Loading knowledge access…</div>;
  if (edges.isError) {
    return (
      <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200">
        Knowledge controls are unavailable on this runtime. This memory remains legacy-only; no assignment was saved.
      </div>
    );
  }

  const save = async () => {
    const [kind, id] = holderKey.split(":", 2) as [KnowledgeHolderKind, string];
    if (!id) return;
    try {
      await actions.upsert.mutateAsync({
        memoryId,
        holder: { kind, id: kind === "world" ? "world" : id },
        stance,
        status: "active",
        confidence: confidence.trim() ? Number(confidence) / 100 : null,
        provenance: [{
          kind: "user_edit",
          author: "user",
          messageIds: [],
          createdAt: new Date().toISOString(),
        }],
      });
      toast.success("Knowledge access saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save knowledge access.");
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3" aria-label="Who knows this?">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">Who knows this?</h3>
          <p className="mt-0.5 text-[0.6875rem] text-[var(--muted-foreground)]">
            Scope controls persistence. These assignments control who may use the memory in Roleplay.
          </p>
        </div>
        {!activeOrInvalidated && (
          <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[0.625rem] font-semibold text-amber-800 dark:text-amber-200">
            Legacy scope
          </span>
        )}
      </div>
      {!activeOrInvalidated && (
        <div className="flex gap-2 rounded-lg border border-amber-400/35 bg-amber-400/10 p-2 text-[0.6875rem] text-amber-800 dark:text-amber-200">
          <AlertTriangle size="0.8rem" className="mt-0.5 shrink-0" />
          The first active assignment switches this memory to explicit access. Missing people will no longer receive it.
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(8rem,0.8fr)_6rem_auto]">
        <select aria-label="Knowledge holder" value={holderKey} onChange={(event) => setHolderKey(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs">
          {(holders.data ?? []).map((holder) => <option key={`${holder.kind}:${holder.id}`} value={`${holder.kind}:${holder.id}`}>{holder.name} · {holder.kind}</option>)}
        </select>
        <select aria-label="Knowledge stance" value={stance} onChange={(event) => setStance(event.target.value as KnowledgeStance)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs">
          {STANCES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input aria-label="Confidence percent" type="number" min="0" max="100" placeholder="%" value={confidence} onChange={(event) => setConfidence(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs" />
        <button type="button" onClick={() => void save()} disabled={actions.upsert.isPending || holders.isLoading} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-45">
          {actions.upsert.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Plus size="0.75rem" />} Assign
        </button>
      </div>
      {(edges.data ?? []).length === 0 ? (
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No explicit knowledge assignments yet.</p>
      ) : (
        <div className="space-y-2">
          {(edges.data ?? []).map((edge) => (
            <div key={edge.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-semibold">{holderLabels.get(`${edge.holder.kind}:${edge.holder.id}`) ?? edge.holder.id}</span>
                  <span className="ml-2 text-[var(--muted-foreground)]">{edge.holder.kind} · {edge.stance} · {edge.status}{typeof edge.confidence === "number" ? ` · ${Math.round(edge.confidence * 100)}%` : ""}</span>
                </div>
                <div className="flex gap-1">
                  {edge.status === "proposed" && <button type="button" aria-label="Approve proposed knowledge edge" onClick={() => void actions.approve.mutateAsync(edge.id)} className="rounded p-1 hover:bg-[var(--accent)]"><Check size="0.8rem" /></button>}
                  {edge.status !== "invalidated" && <button type="button" aria-label={edge.status === "proposed" ? "Reject proposed knowledge edge" : "Invalidate knowledge edge"} onClick={() => void actions.invalidate.mutateAsync({ edgeId: edge.id, reason: edge.status === "proposed" ? "proposal_rejected" : "user_invalidated" })} className="rounded p-1 text-red-500 hover:bg-red-500/10"><X size="0.8rem" /></button>}
                </div>
              </div>
              <div className="mt-1 space-y-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                {edge.provenance.length === 0 ? <div>No provenance recorded</div> : edge.provenance.map((item, index) => (
                  <div key={`${item.createdAt}:${index}`}>{item.kind} · {item.author} · {item.createdAt}{item.sourceChatId ? ` · chat ${item.sourceChatId}` : ""}{item.sceneId ? ` · scene ${item.sceneId}` : ""}{item.messageIds.length ? ` · ${item.messageIds.length} message(s)` : ""}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
