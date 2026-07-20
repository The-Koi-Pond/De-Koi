import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { connectionCatalogApi } from "../../../../shared/api/connection-catalog-api";
import { llmApi } from "../../../../shared/api/llm-api";
import { Modal } from "../../../../shared/components/ui/Modal";
import {
  captureEnhancedOpeningRequest,
  generateEnhancedOpening,
  validateEnhancedOpeningCandidate,
  type EnhancedOpeningAgencyGuidance,
  type EnhancedOpeningRequest,
  type EnhancedOpeningReasonTag,
  type EnhancedOpeningTargetLength,
  type SaveEnhancedOpeningAlternateInput,
} from "../lib/enhanced-opening-generation";

interface EnhancedOpeningGeneratorProps {
  data: CharacterData;
  comment?: string | null;
  onSaveAlternate: (input: SaveEnhancedOpeningAlternateInput) => Promise<void>;
}

type ConnectionAvailability = "checking" | "ready" | "missing";

interface OpeningPreview {
  request: EnhancedOpeningRequest;
  draft: string;
  reasonTags: EnhancedOpeningReasonTag[];
  warnings: string[];
}

function captureRequest(
  data: CharacterData,
  comment: string | null | undefined,
  agencyGuidance: EnhancedOpeningAgencyGuidance,
  targetLength: EnhancedOpeningTargetLength,
): EnhancedOpeningRequest | null {
  try {
    return captureEnhancedOpeningRequest({ data, comment, agencyGuidance, targetLength });
  } catch {
    return null;
  }
}

export function EnhancedOpeningGenerator({ data, comment, onSaveAlternate }: EnhancedOpeningGeneratorProps) {
  const [agencyGuidance, setAgencyGuidance] = useState<EnhancedOpeningAgencyGuidance>("strict");
  const [targetLength, setTargetLength] = useState<EnhancedOpeningTargetLength>("similar");
  const [availability, setAvailability] = useState<ConnectionAvailability>("checking");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentRequest = useMemo(
    () => captureRequest(data, comment, agencyGuidance, targetLength),
    [agencyGuidance, comment, data, targetLength],
  );
  const stale = !!preview && currentRequest?.sourceFingerprint !== preview.request.sourceFingerprint;

  const draftValidation = useMemo(() => {
    if (!preview) return { candidate: null, error: "" };
    try {
      return {
        candidate: validateEnhancedOpeningCandidate(preview.request, preview.draft, data.alternate_greetings),
        error: "",
      };
    } catch (error) {
      return {
        candidate: null,
        error: error instanceof Error ? error.message : "This candidate is not valid.",
      };
    }
  }, [data.alternate_greetings, preview]);

  useEffect(() => {
    let active = true;
    void connectionCatalogApi
      .listAvailable()
      .then((connections) => {
        if (!active) return;
        setAvailability(connectionCatalogApi.selectDefaultTextConnectionId(connections) ? "ready" : "missing");
      })
      .catch(() => {
        if (active) setAvailability("missing");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runGeneration = async (request: EnhancedOpeningRequest) => {
    if (generating) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setGenerating(true);
    setGenerationError("");
    setSaveError("");
    try {
      const connectionId = await connectionCatalogApi.resolveDefaultTextConnectionId();
      const candidate = await generateEnhancedOpening({
        request,
        connectionId,
        llm: llmApi,
        signal: abort.signal,
      });
      setPreview({
        request,
        draft: candidate.text,
        reasonTags: candidate.reasonTags,
        warnings: candidate.warnings,
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setGenerationError(error instanceof Error ? error.message : "Opening generation failed.");
      }
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setGenerating(false);
      }
    }
  };

  const handleGenerate = () => {
    if (currentRequest) void runGeneration(currentRequest);
  };

  const handleRetry = () => {
    const request = stale ? currentRequest : preview?.request;
    if (request) void runGeneration(request);
  };

  const handleSave = async () => {
    if (!preview || stale || !draftValidation.candidate || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSaveAlternate({
        candidate: draftValidation.candidate.text,
        sourceFingerprint: preview.request.sourceFingerprint,
        agencyGuidance: preview.request.agencyGuidance,
        targetLength: preview.request.targetLength,
      });
      toast.success("Saved as an alternate greeting.");
      setPreview(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the alternate greeting.");
    } finally {
      setSaving(false);
    }
  };

  const actionDisabled = availability !== "ready" || !currentRequest || generating || saving || !data.first_mes.trim();

  return (
    <>
      <div className="rounded-xl border border-[var(--border)]/70 bg-[var(--secondary)]/45 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={actionDisabled}
            aria-label="Generate improved alternate opening"
            aria-busy={generating}
            className="de-koi-control-target gap-2 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size="0.875rem" aria-hidden="true" />
            )}
            {generating ? "Improving…" : "Generate improved alternate"}
          </button>

          <label className="sr-only" htmlFor="enhanced-opening-agency">
            User agency guidance
          </label>
          <select
            id="enhanced-opening-agency"
            value={agencyGuidance}
            onChange={(event) => setAgencyGuidance(event.target.value as EnhancedOpeningAgencyGuidance)}
            disabled={generating || saving}
            className="de-koi-control-target rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50"
          >
            <option value="strict">Strict user agency</option>
            <option value="preserve">Preserve user agency</option>
          </select>

          <label className="sr-only" htmlFor="enhanced-opening-length">
            Candidate length
          </label>
          <select
            id="enhanced-opening-length"
            value={targetLength}
            onChange={(event) => setTargetLength(event.target.value as EnhancedOpeningTargetLength)}
            disabled={generating || saving}
            className="de-koi-control-target rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50"
          >
            <option value="similar">Similar length</option>
            <option value="shorter">Shorter opening</option>
          </select>
        </div>
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
          Creates a reviewable alternate. Your original first message stays primary.
        </p>
        {availability === "missing" && (
          <p className="mt-2 text-[0.6875rem] font-medium text-[var(--warning,#d9a441)]">
            Add a text connection in Connections to generate an alternate.
          </p>
        )}
        {!data.first_mes.trim() && (
          <p className="mt-2 text-[0.6875rem] font-medium text-[var(--warning,#d9a441)]">
            Write a first message before generating an alternate.
          </p>
        )}
        {generationError && (
          <p role="alert" className="mt-2 text-xs font-medium text-[var(--destructive)]">
            {generationError}
          </p>
        )}
      </div>

      <Modal
        open={preview !== null}
        onClose={() => {
          if (!saving) setPreview(null);
        }}
        title="Opening workshop"
        width="max-w-5xl"
      >
        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted-foreground)]">
                Compare the authored opening with one editable candidate. Nothing changes until you save the candidate
                as an alternate.
              </p>
              <div className="flex flex-wrap gap-1.5" aria-label="Improvement reasons">
                {(draftValidation.candidate?.reasonTags ?? preview.reasonTags).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--primary)]/25 bg-[var(--primary)]/10 px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--primary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {stale && (
              <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle size="0.875rem" className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                  <span>
                    The character changed after this preview was generated. Regenerate from the current character before
                    saving.
                  </span>
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <section
                aria-labelledby="enhanced-opening-original-heading"
                className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40"
              >
                <div className="border-b border-[var(--border)]/70 px-3 py-2">
                  <h3
                    id="enhanced-opening-original-heading"
                    className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]"
                  >
                    Original
                  </h3>
                </div>
                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap p-4 text-sm leading-relaxed">
                  {preview.request.sourceGreeting}
                </div>
              </section>

              <section
                aria-labelledby="enhanced-opening-candidate-heading"
                className="min-w-0 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/[0.04]"
              >
                <div className="border-b border-[var(--primary)]/20 px-3 py-2">
                  <h3
                    id="enhanced-opening-candidate-heading"
                    className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--primary)]"
                  >
                    Candidate
                  </h3>
                </div>
                <textarea
                  value={preview.draft}
                  onChange={(event) =>
                    setPreview((current) => (current ? { ...current, draft: event.target.value } : current))
                  }
                  aria-label="Generated alternate opening"
                  rows={12}
                  className="min-h-64 w-full resize-y bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-[var(--muted-foreground)]/50"
                />
              </section>
            </div>

            {(draftValidation.candidate?.warnings ?? preview.warnings).length > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3">
                <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-500">
                  Review notes
                </p>
                <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
                  {(draftValidation.candidate?.warnings ?? preview.warnings).map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {draftValidation.error && (
              <p role="alert" className="text-xs font-medium text-[var(--destructive)]">
                {draftValidation.error}
              </p>
            )}
            {saveError && (
              <p role="alert" className="text-xs font-medium text-[var(--destructive)]">
                {saveError}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)]/60 pt-3">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={saving}
                className="de-koi-control-target rounded-lg border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRetry}
                disabled={generating || saving || (stale && !currentRequest)}
                className="de-koi-control-target gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 size="0.8125rem" className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size="0.8125rem" aria-hidden="true" />
                )}
                {stale ? "Regenerate from current" : "Retry"}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={stale || !draftValidation.candidate || generating || saving}
                className="de-koi-control-target gap-2 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size="0.8125rem" className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size="0.8125rem" aria-hidden="true" />
                )}
                Save as alternate
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
