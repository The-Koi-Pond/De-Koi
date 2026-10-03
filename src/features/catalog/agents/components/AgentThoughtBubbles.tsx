// ──────────────────────────────────────────────
// Component: Floating Agent Thought Bubbles
// ──────────────────────────────────────────────
// Compact floating indicator that appears during/after generation
// to show agent activity without requiring the Agents panel open.
// ──────────────────────────────────────────────
import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, X } from "lucide-react";
import { useAgentStore } from "../../../../shared/stores/agent.store";
import { cn } from "../../../../shared/lib/utils";
import { motionStyle } from "../../../../shared/lib/motion";
import { usePresence } from "../../../../shared/hooks/use-presence";
import { ContinuityIssueChecklist } from "./ContinuityIssueChecklist";

const PANEL_MOTION = motionStyle({ enterFrom: { y: 20 }, durationMs: 300 });
const LIST_MOTION = motionStyle({ enterFrom: { y: -6 }, exitTo: { y: -6 }, exitDurationMs: 150 });
const BUBBLE_EXIT_MS = 200;
const BUBBLE_MOTION = motionStyle({
  enterFrom: { x: 20 },
  exitTo: { x: -20 },
  durationMs: 300,
  exitDurationMs: BUBBLE_EXIT_MS,
});

export function AgentThoughtBubbles({ enabledAgentTypes }: { enabledAgentTypes?: Set<string> }) {
  const allThoughtBubbles = useAgentStore((s) => s.thoughtBubbles);
  const isProcessing = useAgentStore((s) => s.isProcessing);
  const dismissThoughtBubble = useAgentStore((s) => s.dismissThoughtBubble);
  const clearThoughtBubbles = useAgentStore((s) => s.clearThoughtBubbles);
  const [collapsed, setCollapsed] = useState(false);

  // Filter bubbles to only agents active in the current chat
  const thoughtBubbles = allThoughtBubbles
    .map((bubble, index) => ({ bubble, storeIndex: index }))
    .filter(({ bubble }) => !enabledAgentTypes || enabledAgentTypes.has(bubble.agentId));
  const showProcessing = isProcessing && (!enabledAgentTypes || enabledAgentTypes.size > 0);
  const handleClearVisibleBubbles = () => {
    if (!enabledAgentTypes) {
      clearThoughtBubbles();
      return;
    }
    for (const { storeIndex } of [...thoughtBubbles].reverse()) {
      dismissThoughtBubble(storeIndex);
    }
  };

  // A dismissed bubble slides out on its own before the list closes up.
  const bubbles = usePresence(thoughtBubbles, ({ bubble }) => `${bubble.agentId}-${bubble.timestamp}`, BUBBLE_EXIT_MS);
  const list = usePresence(!collapsed && thoughtBubbles.length > 0 ? ["list"] : [], (key) => key, 150);

  // Stay mounted until the last dismissed bubble has finished leaving.
  if (thoughtBubbles.length === 0 && !showProcessing && bubbles.length === 0 && list.length === 0) return null;

  return (
    <div className="motion-enter fixed bottom-20 right-4 z-50 w-72 max-w-[calc(100vw-2rem)]" style={PANEL_MOTION}>
      {/* Header bar */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-lg bg-[var(--card)] px-3 py-2 border border-[var(--border)] border-b-0",
          "shadow-lg shadow-black/20",
          collapsed && "rounded-b-lg border-b",
        )}
      >
        <Sparkles size="0.875rem" className="shrink-0 text-[var(--primary)]" />
        <span className="flex-1 text-xs font-medium text-[var(--foreground)]">
          Agents
          {isProcessing && (
            <span className="ml-1.5 text-[var(--muted-foreground)]">
              <span className="motion-breathe">thinking…</span>
            </span>
          )}
        </span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {collapsed ? <ChevronUp size="0.875rem" /> : <ChevronDown size="0.875rem" />}
        </button>
        {thoughtBubbles.length > 0 && (
          <button
            onClick={handleClearVisibleBubbles}
            className="rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            title="Dismiss all"
          >
            <X size="0.875rem" />
          </button>
        )}
      </div>

      {/* Bubble list */}
      {list.map(({ key, exiting }) => (
        <div
          key={key}
          className={cn(
            exiting ? "motion-exit" : "motion-enter",
            "overflow-hidden rounded-b-lg border border-t-0 border-[var(--border)] bg-[var(--card)] shadow-lg shadow-black/20",
          )}
          style={LIST_MOTION}
        >
          <div className="max-h-48 overflow-y-auto p-2 flex flex-col gap-1.5">
            {bubbles.map(({ key, item: { bubble, storeIndex }, exiting }) => (
              <div
                key={key}
                className={cn(
                  exiting ? "motion-exit" : "motion-enter",
                  "relative rounded-md bg-[var(--primary)]/8 p-2 text-xs",
                )}
                style={BUBBLE_MOTION}
              >
                <button
                  // A leaving bubble's store index may already belong to another bubble.
                  disabled={exiting}
                  onClick={() => dismissThoughtBubble(storeIndex)}
                  className="absolute right-1 top-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <X size="0.75rem" />
                </button>
                <div className="pr-4">
                  <span className="font-semibold text-[var(--primary)]">{bubble.agentName}</span>
                  {bubble.agentId === "continuity" ? (
                    <ContinuityIssueChecklist content={bubble.content} />
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap text-[var(--muted-foreground)] leading-relaxed">
                      {bubble.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
