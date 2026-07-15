import { useMemo } from "react";
import { stripDangerousCss } from "../../../../../shared/lib/chat-css";

function escapeStyleContent(css: string) {
  return css.replace(/</g, "\\3c ");
}

function buildPreviewDocument(css: string) {
  const safeCss = escapeStyleContent(stripDangerousCss(css));
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:dark;--background:#111827;--foreground:#f8fafc;--primary:#f472b6;--primary-foreground:#111827;--secondary:#1f2937;--card:#172033;--border:#334155;--muted-foreground:#94a3b8}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--background);color:var(--foreground);font:14px system-ui,sans-serif}.card{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:14px}.row{display:flex;gap:8px;align-items:center}.muted{color:var(--muted-foreground)}button{border:0;border-radius:8px;background:var(--primary);color:var(--primary-foreground);padding:8px 12px}
</style><style>${safeCss}</style></head><body><div class="card"><div class="row"><strong>De-Koi theme preview</strong><span class="muted">Isolated sample</span></div><p>Conversation text, cards, borders, and controls appear here without styling the editor.</p><button type="button">Primary action</button></div></body></html>`;
}

export function ThemePreview({ css, enabled }: { css: string; enabled: boolean }) {
  const srcDoc = useMemo(() => (enabled ? buildPreviewDocument(css) : ""), [css, enabled]);
  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--secondary)]/30 p-4 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
        Preview is off. Turn it on to render this theme in an isolated sample.
      </div>
    );
  }
  return (
    <iframe
      title="Theme preview"
      // An explicitly empty sandbox token list enables every restriction: no scripts, navigation, forms, or same-origin access.
      sandbox=""
      srcDoc={srcDoc}
      className="h-56 w-full rounded-lg border border-[var(--border)] bg-[#111827]"
    />
  );
}
