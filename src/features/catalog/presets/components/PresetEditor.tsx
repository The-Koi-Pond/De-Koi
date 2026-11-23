// ──────────────────────────────────────────────
// Full-Page Preset Editor
// The shell and the Overview tab live in ./preset-overview; the AI Review tab is still here.
// ──────────────────────────────────────────────
import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { HelpTooltip } from "../../../../shared/components/ui/HelpTooltip";
import { connectionsUtilityApi } from "../../../../shared/api/integration-utility-api";
import { reviewPromptPreset } from "../../../../engine/generation/prompt-reviewer";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { PresetEditorShell } from "./preset-overview";

export function PresetEditor() {
  return <PresetEditorShell renderReviewTab={(presetId) => <ReviewTab presetId={presetId} />} />;
}

// ═══════════════════════════════════════════════
//  Review Tab (placeholder — wires to prompt reviewer)
// ═══════════════════════════════════════════════

function ReviewTab({ presetId }: { presetId: string }) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewOutput, setReviewOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startReview = async (connectionId: string) => {
    setReviewing(true);
    setReviewOutput("");
    setError(null);

    try {
      for await (const event of reviewPromptPreset(
        { storage: storageApi, llm: llmApi },
        {
          presetId,
          connectionId,
          streaming: true,
          focusAreas: ["clarity", "consistency", "coverage", "token_efficiency"],
        },
      )) {
        if (event.type === "token") {
          setReviewOutput((prev) => prev + String(event.data ?? ""));
        } else if (event.type === "error") {
          setError(String(event.data ?? "Review failed"));
        }
      }
    } catch (err) {
      setError(toUserMessage(err, { fallback: "Review failed. Try again." }));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <>
      <FieldGroup label="AI Prompt Review">
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Have an AI analyze your prompt preset for clarity, consistency, coverage, and efficiency. This requires an
          active API connection.
        </p>
        <ConnectionSelector
          onSelect={(connId) => startReview(connId)}
          disabled={reviewing}
          label={reviewing ? "Reviewing…" : "Start Review"}
        />
      </FieldGroup>

      {error && (
        <div className="rounded-xl bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">{error}</div>
      )}

      {reviewOutput && (
        <div className="rounded-xl bg-[var(--secondary)] p-4 ring-1 ring-[var(--border)]">
          <pre className="whitespace-pre-wrap text-xs text-[var(--foreground)]">{reviewOutput}</pre>
        </div>
      )}
    </>
  );
}

function FieldGroup({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
        {help && <HelpTooltip text={help} />}
      </label>
      {children}
    </div>
  );
}

/** Simple connection selector — queries the connections API */
function ConnectionSelector({
  onSelect,
  disabled,
  label,
}: {
  onSelect: (connectionId: string) => void;
  disabled: boolean;
  label: string;
}) {
  const [connId, setConnId] = useState("");

  // Quick inline read of connections
  const [connections, setConnections] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    connectionsUtilityApi
      .list<Array<{ id: string; name: string }>>()
      .then((data) => setConnections(data))
      .catch(() => {});
  }, []);

  return (
    <div className="flex gap-2">
      <select
        value={connId}
        onChange={(e) => setConnId(e.target.value)}
        className="flex-1 rounded-xl bg-[var(--secondary)] px-2.5 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none"
      >
        <option value="">Select connection…</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        disabled={disabled || !connId}
        onClick={() => onSelect(connId)}
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
      >
        <Sparkles size="0.8125rem" /> {label}
      </button>
    </div>
  );
}
