import { useEffect, useState } from "react";
import { reviewPromptPreset } from "../../../../../engine/generation/prompt-reviewer";
import { connectionsUtilityApi } from "../../../../../shared/api/integration-utility-api";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";

// The AI Review tab's state (docs/provenance/preset-review.md, "Connections" and "Start Review").

/** A stored connection row; the picker only reads `id` and `name`. */
export interface ConnectionRow {
  id: string | number;
  name?: string | null;
}

const FOCUS_AREAS = ["clarity", "consistency", "coverage", "token_efficiency"];

/**
 * The stored connections, listed once per mount. Empty until the list resolves and when it fails. The result is used
 * as is, so a result that isn't a list reaches the picker (which then throws while rendering).
 */
export function useConnectionList(): ConnectionRow[] {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  useEffect(() => {
    let mounted = true;
    connectionsUtilityApi.list<ConnectionRow[]>().then(
      (rows) => {
        if (mounted) setConnections(rows);
      },
      () => {
        // A failed list leaves the picker empty (spec follow-up 8).
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  return connections;
}

export interface PromptReview {
  reviewing: boolean;
  output: string;
  error: string;
  start: (connectionId: string) => Promise<void>;
}

/**
 * Streams a review of the preset through the chosen connection. Nothing cancels it: after the tab unmounts the stream
 * runs on and its events change nothing (spec follow-up 1).
 */
export function usePromptReview(presetId: string): PromptReview {
  const [reviewing, setReviewing] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const start = async (connectionId: string) => {
    setReviewing(true);
    setOutput("");
    setError("");
    try {
      const events = reviewPromptPreset(
        { storage: storageApi, llm: llmApi },
        { presetId, connectionId, streaming: true, focusAreas: [...FOCUS_AREAS] },
      );
      for await (const event of events) {
        // Event data is shown as it comes, whatever its type (spec, "Recorded details").
        const data: unknown = event.data;
        if (event.type === "token") setOutput((shown) => shown + String(data ?? ""));
        else if (event.type === "error") setError(String(data ?? "Review failed"));
      }
    } catch (reason) {
      setError(toUserMessage(reason, { fallback: "Review failed. Try again." }));
    } finally {
      setReviewing(false);
    }
  };

  return { reviewing, output, error, start };
}
