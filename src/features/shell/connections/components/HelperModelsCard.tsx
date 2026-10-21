import { useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { useConnections } from "../../../catalog/connections";
import { useMutation } from "../../../../shared/hooks/use-mutation";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { modelRoutingApi, modelRoutingKeys } from "../../../../shared/api/model-routing-api";
import {
  MODEL_ROUTE_TASK_LABELS,
  MODEL_ROUTE_TASKS,
  checkModelRoute,
  modelRouteProblemSentence,
  type ModelRouteTask,
} from "../../../../engine/generation/model-routing";
import { boolish, readString, type JsonRecord } from "../../../../engine/generation/runtime-records";

const TASK_SCOPE: Record<ModelRouteTask, string> = {
  memory: "Saving memories, checking them, and cleanup.",
  summaries: "Story recaps, daily chat summaries, and Summarize chat.",
};

function connectionLabel(connection: JsonRecord): string {
  const name = readString(connection.name).trim() || readString(connection.id).trim();
  const model = readString(connection.model).trim();
  return model ? `${name} • ${model}` : name;
}

/** What an unrouted task uses, in words: the rule it followed before helper routing existed. */
function sameAsTodayText(task: ModelRouteTask, agentDefault: JsonRecord | null): string {
  if (!agentDefault) return "Same as today: each chat's connection.";
  if (task === "memory") {
    return `Same as today: Default for Agents (${connectionLabel(agentDefault)}), else each chat's connection.`;
  }
  return `Same as today: each chat's connection. Summarize chat uses Default for Agents (${connectionLabel(agentDefault)}) first.`;
}

function HelperRouteRow({
  task,
  routedId,
  connections,
  agentDefault,
  saving,
  onChange,
}: {
  task: ModelRouteTask;
  routedId: string | null;
  connections: JsonRecord[];
  agentDefault: JsonRecord | null;
  saving: boolean;
  onChange: (connectionId: string | null) => void;
}) {
  const selectId = useId();
  const statusId = useId();
  const label = MODEL_ROUTE_TASK_LABELS[task];
  const check = routedId ? checkModelRoute(routedId, connections) : null;
  const textConnections = connections.filter((connection) => readString(connection.provider) !== "image_generation");
  const routedListed = !!routedId && textConnections.some((connection) => readString(connection.id) === routedId);
  const named = routedId ? connections.find((connection) => readString(connection.id) === routedId) : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-xs font-medium">
        {label}
      </label>
      <p className="text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">{TASK_SCOPE[task]}</p>
      <select
        id={selectId}
        value={routedId ?? ""}
        disabled={saving}
        aria-describedby={statusId}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-wait disabled:opacity-60"
      >
        <option value="">Same as today</option>
        {textConnections.map((connection) => (
          <option key={readString(connection.id)} value={readString(connection.id)}>
            {connectionLabel(connection)}
          </option>
        ))}
        {routedId && !routedListed && (
          <option value={routedId}>{named ? connectionLabel(named) : "Missing connection"}</option>
        )}
      </select>
      <p
        id={statusId}
        className={
          check && !check.ok
            ? "text-[0.625rem] font-medium leading-relaxed text-[var(--destructive)]"
            : "text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]"
        }
      >
        {!check
          ? sameAsTodayText(task, agentDefault)
          : check.ok
            ? `Uses ${connectionLabel(check.connection)}.`
            : `${modelRouteProblemSentence(task, check.problem, readString(named?.name).trim() || routedId!)} It won't run until you pick another connection or "Same as today".`}
      </p>
    </div>
  );
}

export function HelperModelsCard() {
  const queryClient = useQueryClient();
  const { data: connectionRows } = useConnections();
  const {
    data: settings,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: modelRoutingKeys.settings,
    queryFn: modelRoutingApi.get,
  });
  const saveRoute = useMutation({
    mutationFn: ({ task, connectionId }: { task: ModelRouteTask; connectionId: string | null }) =>
      modelRoutingApi.setRoute(task, connectionId),
    onSuccess: (next) => queryClient.setQueryData(modelRoutingKeys.settings, next),
    meta: { errorMessage: "Couldn't save the helper model. Try again." },
  });

  const connections = (connectionRows ?? []) as JsonRecord[];
  const agentDefault =
    connections.find(
      (connection) =>
        readString(connection.provider) !== "image_generation" && boolish(connection.defaultForAgents, false),
    ) ?? null;

  return (
    <section
      aria-labelledby="helper-models-heading"
      className="rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/5 to-teal-500/5 p-3"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
          <Route size="1rem" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="helper-models-heading" className="text-sm font-medium">
            Helper Models
          </h3>
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Send background helper work to a cheaper or local model. Replies always use each chat's connection.
          </p>
        </div>
      </div>
      {isError && !settings && (
        <div role="alert" className="mt-3 flex flex-col items-start gap-2">
          <p className="text-[0.6875rem] text-[var(--destructive)]">
            {toUserMessage(error, { fallback: "Couldn't load your helper models." })}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      )}
      {settings && (
        <div className="mt-3 flex flex-col gap-3">
          {MODEL_ROUTE_TASKS.map((task) => (
            <HelperRouteRow
              key={task}
              task={task}
              routedId={settings.routes[task] ?? null}
              connections={connections}
              agentDefault={agentDefault}
              saving={saveRoute.isPending}
              onChange={(connectionId) => saveRoute.mutate({ task, connectionId })}
            />
          ))}
          <p className="text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            An agent with its own connection keeps it, including the Chat Summary agent for Summarize chat.
          </p>
        </div>
      )}
    </section>
  );
}
