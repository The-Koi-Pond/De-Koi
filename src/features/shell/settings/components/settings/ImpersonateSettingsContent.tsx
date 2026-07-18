import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DEFAULT_IMPERSONATE_PROMPT } from "../../../../../engine/contracts/constants/impersonate";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { useUIStore } from "../../../../../shared/stores/ui.store";

export function ImpersonateSettingsContent({
  presets,
  connections,
}: {
  presets: Array<{ id: string; name: string }>;
  connections: Array<{ id: string; name: string }>;
}) {
  const promptTemplate = useUIStore((s) => s.impersonatePromptTemplate);
  const setPromptTemplate = useUIStore((s) => s.setImpersonatePromptTemplate);
  const cyoaChoices = useUIStore((s) => s.impersonateCyoaChoices);
  const setCyoaChoices = useUIStore((s) => s.setImpersonateCyoaChoices);
  const presetId = useUIStore((s) => s.impersonatePresetId);
  const setPresetId = useUIStore((s) => s.setImpersonatePresetId);
  const connectionId = useUIStore((s) => s.impersonateConnectionId);
  const setConnectionId = useUIStore((s) => s.setImpersonateConnectionId);
  const blockAgents = useUIStore((s) => s.impersonateBlockAgents);
  const setBlockAgents = useUIStore((s) => s.setImpersonateBlockAgents);
  const hasPromptTemplate = promptTemplate.trim().length > 0;
  const promptStatus = hasPromptTemplate ? "Custom" : "Chat/default";

  const [defaultOpen, setDefaultOpen] = useState(false);

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs font-semibold">Prompt Template</span>
            <HelpTooltip text="Optional global instruction sent to the model when you /impersonate. Leave empty to use the chat-specific prompt, or the built-in default if that chat has none. Macros like {{user}}, {{persona_description}} and {{impersonate_direction}} are replaced before sending." />
          </div>
          <span className="shrink-0 rounded-full bg-[var(--secondary)]/55 px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
            {promptStatus}
          </span>
        </div>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder="Empty = use chat/built-in default"
          rows={4}
          className="min-h-20 w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-1.5 font-mono text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setDefaultOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/70 hover:text-[var(--foreground)]"
          >
            {defaultOpen ? <ChevronDown size="0.6875rem" /> : <ChevronRight size="0.6875rem" />}
            Built-in default
          </button>
          {hasPromptTemplate && (
            <button
              onClick={() => setPromptTemplate("")}
              className="flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Reset to default"
            >
              <RotateCcw size="0.625rem" />
              Reset
            </button>
          )}
        </div>
        {defaultOpen && (
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--secondary)]/40 px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
            {DEFAULT_IMPERSONATE_PROMPT}
          </pre>
        )}
      </div>

      <div className="space-y-1.5 rounded-lg bg-[var(--secondary)]/20 p-2 ring-1 ring-[var(--border)]">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.6875rem] font-semibold">Preset</span>
              <HelpTooltip text="Use a specific prompt preset for roleplay impersonate generations only. Conversation mode does not use prompt presets. Falls back to the chat's preset when set to 'Use chat default'." />
            </div>
            <select
              value={presetId ?? ""}
              onChange={(e) => setPresetId(e.target.value || null)}
              className="w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            >
              <option value="">Use chat default</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.6875rem] font-semibold">Connection</span>
              <HelpTooltip text="Use a specific connection (model/provider) for impersonate generations only. Useful for routing impersonate to a cheaper or faster model." />
            </div>
            <select
              value={connectionId ?? ""}
              onChange={(e) => setConnectionId(e.target.value || null)}
              className="w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            >
              <option value="">Use chat default</option>
              <option value="random">Random</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-1 border-t border-[var(--border)]/60 pt-1.5">
          <label className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent)]/35">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                Skip agents
                <span onClick={(e) => e.preventDefault()}>
                  <HelpTooltip text="When enabled, the agent pipeline (trackers, lorebook routers, etc.) is suppressed during impersonate so generations stay fast and don't trigger world-state mutations." />
                </span>
              </span>
              <span className="mt-0.5 block text-[0.65rem] leading-tight text-[var(--muted-foreground)]">
                Suppress trackers, routers, and other agent work.
              </span>
            </span>
            <input
              type="checkbox"
              checked={blockAgents}
              onChange={(e) => setBlockAgents(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
            />
          </label>

          <label className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent)]/35">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                Use CYOA as direction
                <span onClick={(e) => e.preventDefault()}>
                  <HelpTooltip text="When enabled, clicking a CYOA option uses it as the direction for an impersonate generation instead of sending the option as a normal user message." />
                </span>
              </span>
              <span className="mt-0.5 block text-[0.65rem] leading-tight text-[var(--muted-foreground)]">
                Treat choices as impersonate guidance.
              </span>
            </span>
            <input
              type="checkbox"
              checked={cyoaChoices}
              onChange={(e) => setCyoaChoices(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
            />
          </label>
        </div>

        <p className="border-t border-[var(--border)]/60 px-2 pt-1.5 text-[0.65rem] leading-snug text-[var(--muted-foreground)]">
          Enable Quick Send in Settings &gt; General &gt; Chat behavior.
        </p>
      </div>
    </div>
  );
}
