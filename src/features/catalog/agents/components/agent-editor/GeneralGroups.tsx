import { Activity, Clock, Info, Layers, Link2, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "../../../../../shared/lib/utils";
import { FIELD, FieldGroup, NOTE, SettingToggle, ToggleCard } from "./editor-parts";
import type { AgentEditorModel } from "./use-agent-editor";

const PHASES: Record<string, { label: string; description: string; icon: LucideIcon; tint: string } | undefined> = {
  pre_generation: {
    label: "Pre-Generation",
    description: "Runs before the main AI response. Can inject context or modify the prompt.",
    icon: Zap,
    tint: "text-amber-400",
  },
  parallel: {
    label: "Parallel",
    description: "Runs alongside or after the main generation. Independent processing.",
    icon: Activity,
    tint: "text-sky-400",
  },
  post_processing: {
    label: "Post-Processing",
    description: "Runs after the main AI response. Can analyze and extract data from it.",
    icon: Clock,
    tint: "text-emerald-400",
  },
};

const PHASE_ORDER = ["pre_generation", "parallel", "post_processing"] as const;

/** The chosen phase's label and description; a phase outside the three throws, as the old editor did. */
export function phaseInfo(phase: string) {
  return PHASES[phase]!;
}

export function DescriptionGroup({ editor }: { editor: AgentEditorModel }) {
  const id = useId();
  return (
    <FieldGroup
      icon={Info}
      label="Description"
      htmlFor={id}
      help="A short summary of what this agent does. Shown in the agents panel to help you identify each agent."
    >
      <input
        id={id}
        type="text"
        value={editor.form.description ?? ""}
        onChange={(event) => editor.edit({ description: event.target.value })}
        placeholder="What does this agent do…"
        className={FIELD}
      />
    </FieldGroup>
  );
}

export function AuthorGroup({ editor }: { editor: AgentEditorModel }) {
  const id = useId();
  return (
    <FieldGroup icon={Sparkles} label="Author" htmlFor={id} help="Who authored or maintains this agent.">
      <input
        id={id}
        type="text"
        value={String(editor.form.author)}
        onChange={(event) => editor.edit({ author: event.target.value })}
        placeholder="Author name..."
        className={FIELD}
      />
    </FieldGroup>
  );
}

export function StatusGroup({ editor }: { editor: AgentEditorModel }) {
  const { enabled } = editor.form;
  return (
    <FieldGroup
      icon={Sparkles}
      label="Agent Status"
      help="Globally enables or disables this agent. Disabled agents stay configured but do not run."
    >
      <ToggleCard
        on={enabled}
        title={enabled ? "Enabled" : "Disabled"}
        description={
          enabled
            ? "This agent can run when it is active for a chat."
            : "This agent will not run until it is enabled again."
        }
        onToggle={() => editor.edit((current) => ({ enabled: !current.enabled }))}
      />
    </FieldGroup>
  );
}

export function PhaseGroup({ editor }: { editor: AgentEditorModel }) {
  const { phase } = editor.form;
  return (
    <FieldGroup
      icon={Zap}
      label="Pipeline Phase"
      help="When this agent runs during generation. Pre-Generation runs before the AI replies, Parallel runs alongside, Post-Processing runs after the reply is complete."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PHASE_ORDER.map((value) => {
          const option = PHASES[value]!;
          const Icon = option.icon;
          const active = value === phase;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => editor.edit({ phase: value })}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded-xl p-3 text-xs font-medium ring-1 transition-all",
                active
                  ? cn("bg-[var(--primary)]/10 ring-[var(--primary)]", option.tint)
                  : "text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)]",
              )}
            >
              <Icon size="1rem" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className={NOTE}>{phaseInfo(phase).description}</p>
    </FieldGroup>
  );
}

export function ConnectionGroup({ editor }: { editor: AgentEditorModel }) {
  const id = useId();
  const fallback = editor.agentDefaultConnection;
  return (
    <FieldGroup
      icon={Link2}
      label="Connection Override"
      htmlFor={id}
      help="Use a different AI connection for this agent. For example, use a faster/cheaper model for background processing tasks."
    >
      <select
        id={id}
        value={editor.form.connectionId}
        onChange={(event) => editor.edit({ connectionId: event.target.value })}
        className={FIELD}
      >
        <option value="">{fallback ? `Agent default (${fallback.name})` : "Use chat connection"}</option>
        {editor.llmConnections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.name} ({connection.provider})
          </option>
        ))}
      </select>
      <p className={cn(NOTE, "mt-1")}>
        When empty, uses the agent default connection if one is set, otherwise falls back to the chat&apos;s active
        connection.
      </p>
    </FieldGroup>
  );
}

export function PromptSectionGroup({ editor }: { editor: AgentEditorModel }) {
  const { injectAsSection, name } = editor.form;
  return (
    <FieldGroup
      icon={Layers}
      label="Add as Prompt Section"
      help="When enabled, this agent's output becomes available as a marker section in prompt presets. Add the section in your preset to inject the agent's latest data into the prompt."
    >
      <SettingToggle
        on={injectAsSection}
        title={injectAsSection ? "Enabled" : "Disabled"}
        description={
          injectAsSection
            ? `"${name}" appears as a section option in prompt presets`
            : "Agent output is not injected into prompts"
        }
        onToggle={() => editor.edit((current) => ({ injectAsSection: !current.injectAsSection }))}
      />
    </FieldGroup>
  );
}
