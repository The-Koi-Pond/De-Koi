import { useId } from "react";
import { Plug } from "lucide-react";
import type { ConnectionSummary } from "../../../../../catalog/connections/index";
import { defaultConnectionLabel } from "./setup-chat";
import { SETUP_FIELD_LABEL_CLASS, SETUP_SELECT_CLASS } from "./setup-styles";

/**
 * Picks the chat's connection: a saved language connection, the random pool, or none, which replies through the
 * default connection and says which one (decision 6). Without any connection it offers to set one up instead.
 */
export function SetupConnectionPicker({
  connectionId,
  connections,
  savedConnections,
  loading,
  onChange,
  onSetUpConnection,
}: {
  connectionId: string | null;
  /** Language connections only. */
  connections: readonly ConnectionSummary[];
  /** Every connection, to name the one a chat without a connection replies through. */
  savedConnections: readonly ConnectionSummary[];
  loading: boolean;
  onChange: (connectionId: string | null) => void;
  onSetUpConnection: () => void;
}) {
  const selectId = useId();

  if (loading) {
    return <p className="text-xs text-[var(--muted-foreground)]">Loading connections…</p>;
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-3">
        <p className="text-xs text-[var(--muted-foreground)]">You don't have a connection yet.</p>
        <button
          type="button"
          onClick={onSetUpConnection}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          <Plug size="0.8rem" aria-hidden="true" />
          Set up a connection
        </button>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={selectId} className={SETUP_FIELD_LABEL_CLASS}>
        Connection
      </label>
      <select
        id={selectId}
        value={connectionId ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className={SETUP_SELECT_CLASS}
      >
        <option value="">{defaultConnectionLabel(savedConnections)}</option>
        <option value="random">🎲 Random</option>
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.name}
            {connection.model ? ` · ${connection.model}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
