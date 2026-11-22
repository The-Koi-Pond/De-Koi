import { Wrench } from "lucide-react";
import { useState } from "react";
import { BUILT_IN_TOOLS, type ToolParameterSchema } from "../../../../../engine/contracts/types/agent";
import { cn } from "../../../../../shared/lib/utils";
import { isCustomToolSelectable } from "../../hooks/use-custom-tools";
import { LOREBOOK_WRITE_TOOL_NAME } from "../../lib/agent-lorebook-writer-settings";
import { FieldGroup, NOTE, ToggleIcon } from "./editor-parts";
import type { AgentEditorModel } from "./use-agent-editor";

interface ToolCardData {
  name: string;
  description: string;
  /** As stored for custom tools: may be null, a JSON string or carry odd values (see the spec's follow-ups). */
  parameters: ToolParameterSchema;
  custom: boolean;
}

function toolCards(editor: AgentEditorModel): ToolCardData[] {
  const builtIn = BUILT_IN_TOOLS.filter((tool) => tool.name !== LOREBOOK_WRITE_TOOL_NAME).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    custom: false,
  }));
  const custom = (editor.customTools ?? [])
    .filter((tool) => isCustomToolSelectable(tool, editor.toolCapabilities))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema as unknown as ToolParameterSchema,
      custom: true,
    }));
  return [...builtIn, ...custom];
}

function ToolCard({ tool, editor }: { tool: ToolCardData; editor: AgentEditorModel }) {
  const [expanded, setExpanded] = useState(false);
  const enabled = editor.form.enabledTools.includes(tool.name);
  const params = Object.entries(tool.parameters.properties ?? {});
  const required = tool.parameters.required;
  return (
    <li
      className={cn(
        "rounded-xl ring-1 transition-colors",
        enabled ? "bg-[var(--primary)]/5 ring-[var(--primary)]/50" : "ring-[var(--border)]",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-pressed={enabled}
          aria-label={tool.name}
          onClick={() =>
            editor.edit((current) => ({
              enabledTools: current.enabledTools.includes(tool.name)
                ? current.enabledTools.filter((name) => name !== tool.name)
                : [...current.enabledTools, tool.name],
            }))
          }
          className={cn(
            "shrink-0 rounded-md p-0.5 transition-colors hover:bg-[var(--accent)]",
            enabled ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]",
          )}
        >
          <ToggleIcon on={enabled} size="1.25rem" onClassName="text-[var(--primary)]" />
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              tool.custom ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "text-[var(--muted-foreground)]",
            )}
          >
            <Wrench size="0.75rem" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <code className="font-mono text-xs font-semibold text-[var(--foreground)]">{tool.name}</code>
              {tool.custom && (
                <span className="rounded bg-[var(--primary)]/15 px-1 py-0.5 text-[0.5625rem] font-medium text-[var(--primary)]">
                  custom
                </span>
              )}
            </span>
            {tool.description && (
              <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">{tool.description}</span>
            )}
          </span>
          <span aria-hidden="true" className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">
            {expanded ? "▲" : "▼"}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <p className="mb-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">Parameters:</p>
          <ul className="space-y-0.5">
            {params.map(([name, p]) => (
              <li key={name} className="text-[0.625rem] text-[var(--muted-foreground)]">
                <code className="font-mono text-[var(--foreground)]">{name}</code>
                {required?.includes(name) && <span className="text-red-500">*</span>}
                <span className="ml-1 text-[var(--primary)]">{p.type}</span>
                {p.description && <span> — {p.description}</span>}
                {p.enum && <span className="ml-1">[{p.enum.join(", ")}]</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function ToolsGroup({ editor }: { editor: AgentEditorModel }) {
  return (
    <FieldGroup
      icon={Wrench}
      label="Tools / Function Calling"
      help="Select which tools this agent can use during generation. The AI can call these functions and receive results back for multi-step interactions."
    >
      <p className={NOTE}>
        Toggle tools on or off for this agent. When enabled for a chat, only selected tools will be available during
        generation.
      </p>
      <ul className="space-y-2">
        {toolCards(editor).map((tool) => (
          <ToolCard key={`${tool.custom ? "custom" : "builtin"}:${tool.name}`} tool={tool} editor={editor} />
        ))}
      </ul>
      <p className={NOTE}>
        Tool-use must also be enabled per chat via Chat Settings → &quot;Enable Function Calling&quot;.
      </p>
    </FieldGroup>
  );
}
