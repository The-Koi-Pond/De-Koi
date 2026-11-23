import { Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useConnectionList, usePromptReview, type ConnectionRow } from "./use-prompt-review";

// The AI Review tab (docs/provenance/preset-review.md, "The tab"): the connection picker, Start Review, the error box
// and the streamed output. Its parts are spaced by the shell's content column, so it returns a fragment.

/** A labelled field like the Overview ones, without a help icon. The label wraps no control. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
      </label>
      {children}
    </div>
  );
}

interface ConnectionPickerProps {
  connections: ConnectionRow[];
  value: string;
  onChange: (connectionId: string) => void;
}

function ConnectionPicker({ connections, value, onChange }: ConnectionPickerProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Connection"
      className="flex-1 rounded-xl bg-[var(--secondary)] px-2.5 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none"
    >
      <option value="">Select connection…</option>
      {/* Rows are shown as listed: a nameless row is an empty option, and repeated ids aren't handled (follow-up 5). */}
      {connections.map((connection) => (
        <option key={connection.id} value={connection.id}>
          {connection.name}
        </option>
      ))}
    </select>
  );
}

export function PresetReviewTab({ presetId }: { presetId: string }) {
  const connections = useConnectionList();
  const [connectionId, setConnectionId] = useState("");
  const review = usePromptReview(presetId);

  return (
    <>
      <Field label="AI Prompt Review">
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Have an AI analyze your prompt preset for clarity, consistency, coverage, and efficiency. This requires an
          active API connection.
        </p>
        <div className="flex gap-2">
          <ConnectionPicker connections={connections} value={connectionId} onChange={setConnectionId} />
          <button
            type="button"
            onClick={() => void review.start(connectionId)}
            disabled={review.reviewing || !connectionId}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Sparkles size="0.8125rem" aria-hidden="true" /> {review.reviewing ? "Reviewing…" : "Start Review"}
          </button>
        </div>
      </Field>
      {review.error && (
        <div role="alert" className="rounded-xl bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
          {review.error}
        </div>
      )}
      {review.output && (
        <div aria-live="polite" className="rounded-xl bg-[var(--secondary)] p-4 ring-1 ring-[var(--border)]">
          <pre className="whitespace-pre-wrap text-xs text-[var(--foreground)]">{review.output}</pre>
        </div>
      )}
    </>
  );
}
