import { Layers, MessageSquare, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/** An agent row as `useAgentConfigs()` lists it (settings stored as text don't count). */
export interface InjectableAgent {
  type: string;
  name: unknown;
}

export type AddChoice =
  { kind: "prompt" } | { kind: "marker"; type: string; label: string } | { kind: "agent"; agent: InjectableAgent };

const ITEM = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-[var(--accent)]";
const HEADING = "px-3 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]";

function Divider() {
  return <div className="my-1 border-t border-[var(--border)]" />;
}

/** The Add Section menu under its button, over a full-page click-catcher (docs/provenance/preset-sections.md). */
export function AddSectionMenu({
  markers,
  agents,
  onChoose,
  onClose,
}: {
  /** The marker types the menu offers, in label order, with their labels. */
  markers: ReadonlyArray<readonly [string, string]>;
  agents: InjectableAgent[];
  onChoose: (choice: AddChoice) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div data-click-catcher className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl">
        <button type="button" onClick={() => onChoose({ kind: "prompt" })} className={ITEM}>
          <MessageSquare size="0.8125rem" /> Prompt Block
        </button>
        <Divider />
        <p className={HEADING}>Markers</p>
        {markers.map(([type, label]) => (
          <button key={type} type="button" onClick={() => onChoose({ kind: "marker", type, label })} className={ITEM}>
            <Layers size="0.8125rem" className="text-purple-400" /> {label}
          </button>
        ))}
        {agents.length > 0 && (
          <>
            <Divider />
            <p className={HEADING}>Agent Sections</p>
            {agents.map((agent, index) => (
              <button
                key={`${agent.type}-${index}`}
                type="button"
                onClick={() => onChoose({ kind: "agent", agent })}
                className={ITEM}
              >
                <Sparkles size="0.8125rem" className="text-[var(--primary)]" /> {agent.name as ReactNode} (Agent)
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
