import { Wand2 } from "lucide-react";

interface ChatSetupResumeCardProps {
  onResume: () => void;
}

/** Shown on an empty chat (no characters, no messages), e.g. one whose setup wizard was left early. */
export function ChatSetupResumeCard({ onResume }: ChatSetupResumeCardProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
      <div
        role="region"
        aria-label="Chat setup"
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-center shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-[var(--foreground)]">This chat isn't set up yet</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
          Pick a connection and characters to start.
        </p>
        <button
          type="button"
          onClick={onResume}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition-all hover:opacity-90 active:scale-95"
        >
          <Wand2 size="0.75rem" />
          Continue setup
        </button>
      </div>
    </div>
  );
}
