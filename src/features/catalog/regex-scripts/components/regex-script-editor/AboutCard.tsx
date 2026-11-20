const CODE = "rounded bg-[var(--secondary)] px-1 font-mono";
const EMPHASIS = "font-semibold text-[var(--foreground)]";

export function AboutCard({ scriptId }: { scriptId: string | null }) {
  return (
    <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
      <h4 className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">About Regex Scripts</h4>
      <div className="space-y-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
        <p>
          Regex scripts are applied to text during chat — either transforming AI responses before display, or modifying
          your input before it&apos;s sent.
        </p>
        <p>
          Scripts run in order (lowest first). Use capture groups (<code className={CODE}>$1</code>,{" "}
          <code className={CODE}>$2</code>) in the replacement to reference matched groups. Use{" "}
          <code className={CODE}>{"\\u$1"}</code> to capitalize the first character of a capture, or{" "}
          <code className={CODE}>{"\\U$1\\E"}</code> to uppercase a capture.
        </p>
        <p className={EMPHASIS}>Examples:</p>
        <ul className="list-disc pl-4">
          <li>
            Remove asterisks: <code className={CODE}>{"\\\\*([^*]+)\\\\*"}</code> → <code className={CODE}>$1</code>
          </li>
          <li>
            Remove OOC: <code className={CODE}>{"\\\\(OOC:.*?\\\\)"}</code> → (empty)
          </li>
          <li>
            Censor words: <code className={CODE}>{"\\\\bbadword\\\\b"}</code> → <code className={CODE}>***</code>
          </li>
          <li>
            Capitalize replacement: <code className={CODE}>{"\\U$1"}</code>
          </li>
        </ul>
        {scriptId && (
          <p className="pt-1">
            <span className={EMPHASIS}>ID:</span> {scriptId}
          </p>
        )}
      </div>
    </div>
  );
}
