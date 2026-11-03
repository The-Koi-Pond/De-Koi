import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, LogIn } from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { useOpenRouterLogin } from "../lib/use-openrouter-login";

interface Props {
  /** Saves or creates the OpenRouter connection and returns its id, or null to stop. */
  prepare: () => Promise<string | null>;
  /** "hero" leads the empty Connections panel; "inline" sits by an OpenRouter connection's key box. */
  variant: "hero" | "inline";
  hasSavedKey?: boolean;
  /** Runs when the user backs out of a login that never finished. */
  onCancel?: () => void;
}

const PRIMARY_BUTTON =
  "flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60";
const QUIET_BUTTON =
  "rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]";
const LINK_BUTTON =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]";

export function OpenRouterLoginCard({ prepare, variant, hasSavedKey = false, onCancel }: Props) {
  const { phase, start, submitCode, reset } = useOpenRouterLogin();
  const [code, setCode] = useState("");

  const cancel = () => {
    reset();
    setCode("");
    onCancel?.();
  };
  const begin = () => {
    setCode("");
    void start(prepare);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5",
        variant === "hero"
          ? "rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4"
          : "rounded-xl bg-[var(--secondary)]/60 px-3 py-3 ring-1 ring-[var(--border)]",
      )}
      aria-live="polite"
    >
      {(phase.kind === "idle" || phase.kind === "starting") && (
        <>
          {variant === "hero" && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Easiest: log in with OpenRouter</h3>
              <p className="de-koi-body leading-relaxed text-[var(--muted-foreground)]">
                Free models, nothing to copy. You log in or make a free account in your browser, and De-Koi saves the
                key for you.
              </p>
            </div>
          )}
          <button type="button" onClick={begin} disabled={phase.kind === "starting"} className={PRIMARY_BUTTON}>
            {phase.kind === "starting" ? (
              <Loader2 size="0.8125rem" className="animate-spin" />
            ) : (
              <LogIn size="0.8125rem" />
            )}
            {hasSavedKey ? "Log in again with OpenRouter" : "Log in with OpenRouter"}
          </button>
          {variant === "inline" && (
            <p className="text-xs text-[var(--muted-foreground)]">
              {hasSavedKey
                ? "Replaces the saved key with a new one from your OpenRouter account."
                : "Opens OpenRouter in your browser and saves the key here, so you don't have to paste one."}
            </p>
          )}
        </>
      )}

      {phase.kind === "waiting" && phase.mode === "callback" && (
        <>
          <p className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
            <Loader2 size="0.8125rem" className="shrink-0 animate-spin text-[var(--primary)]" />
            {phase.browserOpenFailed
              ? "Your browser didn't open. Use the button below, log in, and approve De-Koi."
              : "Finish in your browser: log in to OpenRouter and approve De-Koi. This updates by itself."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={phase.authUrl} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
              <ExternalLink size="0.75rem" />
              {phase.browserOpenFailed ? "Open OpenRouter login" : "Open the login page again"}
            </a>
            <button type="button" onClick={cancel} className={QUIET_BUTTON}>
              Cancel
            </button>
          </div>
        </>
      )}

      {phase.kind === "waiting" && phase.mode === "code" && (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCode(code);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-[var(--foreground)]">1. Log in to OpenRouter and approve De-Koi.</p>
            <a href={phase.authUrl} target="_blank" rel="noopener noreferrer" className={cn(LINK_BUTTON, "self-start")}>
              <ExternalLink size="0.75rem" />
              Open OpenRouter login
            </a>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--foreground)]">
              2. OpenRouter shows a code. Copy it and paste it here.
            </span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste the code"
              aria-invalid={phase.codeError ? true : undefined}
              className="w-full rounded-lg bg-[var(--card)] px-3 py-2 text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </label>
          {phase.codeError && <p className="text-xs text-[var(--destructive)]">{phase.codeError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={phase.submittingCode || !code.trim()} className={PRIMARY_BUTTON}>
              {phase.submittingCode && <Loader2 size="0.8125rem" className="animate-spin" />}
              Finish
            </button>
            <button type="button" onClick={cancel} className={QUIET_BUTTON}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {phase.kind === "finishing" && (
        <p className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
          <Loader2 size="0.8125rem" className="shrink-0 animate-spin text-[var(--primary)]" />
          Logged in. Setting up the connection…
        </p>
      )}

      {phase.kind === "done" && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
            <CheckCircle2 size="0.875rem" className="shrink-0 text-emerald-500" />
            {phase.freeModelName
              ? `Logged in to OpenRouter. Chats use ${phase.freeModelName}, which is free.`
              : "Logged in to OpenRouter. Your key is saved."}
          </p>
          {phase.note && <p className="text-xs text-[var(--muted-foreground)]">{phase.note}</p>}
        </div>
      )}

      {phase.kind === "error" && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {phase.message}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={begin} className={PRIMARY_BUTTON}>
              <LogIn size="0.8125rem" />
              Try again
            </button>
            <button type="button" onClick={cancel} className={QUIET_BUTTON}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
