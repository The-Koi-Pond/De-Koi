import { Clock } from "lucide-react";
import { useId } from "react";
import {
  DEFAULT_AGENT_CONTEXT_SIZE,
  DEFAULT_AGENT_MAX_TOKENS,
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
} from "../../../../../engine/contracts/types/agent";
import type { AgentRunIntervalMeta } from "../../../../../shared/lib/agent-cadence";
import { cn } from "../../../../../shared/lib/utils";
import { clampMaxTokens, readClampedCount, readMaxTokens } from "./agent-form";
import { FIELD, FieldGroup, NOTE, SMALL_LABEL, UnitInput } from "./editor-parts";
import type { AgentEditorModel } from "./use-agent-editor";

const NUMBER = cn(FIELD, "w-28");

export function BudgetGroup({ editor }: { editor: AgentEditorModel }) {
  const contextId = useId();
  const tokensId = useId();
  const chatSummary = editor.isType("chat-summary");
  const { form, edit } = editor;
  return (
    <FieldGroup
      icon={Clock}
      label="Agent Budget"
      help="Controls how much recent chat context the agent reads and how much output room it reserves. If max output is too high for the model context, prompt context can be trimmed."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {chatSummary ? (
          <p className="rounded-xl bg-[var(--accent)]/50 p-3 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
            Chat Summary context size is managed in the Chat Summary panel inside each chat.
          </p>
        ) : (
          <div>
            <label htmlFor={contextId} className={SMALL_LABEL}>
              Context Size
            </label>
            <UnitInput unit="messages">
              <input
                id={contextId}
                type="number"
                min={1}
                max={200}
                value={form.contextSize}
                placeholder={String(DEFAULT_AGENT_CONTEXT_SIZE)}
                onChange={(event) => edit({ contextSize: readClampedCount(event.target.value, 200) })}
                className={NUMBER}
              />
            </UnitInput>
          </div>
        )}
        <div>
          <label htmlFor={tokensId} className={SMALL_LABEL}>
            Max Output Tokens
          </label>
          <UnitInput unit="tokens">
            <input
              id={tokensId}
              type="number"
              min={MIN_AGENT_MAX_TOKENS}
              max={MAX_AGENT_MAX_TOKENS}
              value={form.maxTokens}
              placeholder={String(DEFAULT_AGENT_MAX_TOKENS)}
              onChange={(event) => edit({ maxTokens: readMaxTokens(event.target.value) })}
              // Leaving the box only tidies the value; it isn't an edit.
              onBlur={() => editor.setForm((current) => ({ ...current, maxTokens: clampMaxTokens(current.maxTokens) }))}
              className={cn(FIELD, "w-32")}
            />
          </UnitInput>
        </div>
      </div>
      {!chatSummary && (
        <p className={NOTE}>
          Each agent only sees its own context size. When agents are batched together (same model), the highest context
          size in the batch is used and output budgets are combined.
        </p>
      )}
      <p className={NOTE}>
        For 8k local models, try {DEFAULT_AGENT_MAX_TOKENS.toLocaleString()} or lower so the agent prompt keeps enough
        room.
      </p>
    </FieldGroup>
  );
}

interface IntervalGroupProps {
  editor: AgentEditorModel;
  label: string;
  help: string;
  unit: string;
  max: number;
  placeholder: number;
  note: string;
}

/** A built-in agent's own interval box (Triggers After, Run Interval, the Illustrator's cadence). */
function IntervalGroup({ editor, label, help, unit, max, placeholder, note }: IntervalGroupProps) {
  const id = useId();
  return (
    <FieldGroup icon={Clock} label={label} htmlFor={id} help={help}>
      <UnitInput unit={unit}>
        <input
          id={id}
          type="number"
          min={1}
          max={max}
          value={editor.form.runInterval}
          placeholder={String(placeholder)}
          onChange={(event) => editor.edit({ runInterval: readClampedCount(event.target.value, max) })}
          className={NUMBER}
        />
      </UnitInput>
      <p className={NOTE}>{note}</p>
    </FieldGroup>
  );
}

export function TriggersAfterGroup({ editor }: { editor: AgentEditorModel }) {
  return (
    <IntervalGroup
      editor={editor}
      label="Triggers After"
      help="How many user messages must be sent since the last automatic summary before the agent triggers again. The context size for each summary generation is set in the Chat Summary panel in the chat itself."
      unit="user messages"
      max={200}
      placeholder={5}
      note="The automatic summary will trigger after this many user messages have been sent since the last summary update."
    />
  );
}

export function KeeperRunIntervalGroup({ editor }: { editor: AgentEditorModel }) {
  return (
    <IntervalGroup
      editor={editor}
      label="Run Interval"
      help="How many assistant messages between each Lorebook Keeper run. Higher values reduce duplicates and save tokens. Set to 1 to run every message."
      unit="messages"
      max={100}
      placeholder={8}
      note="The agent runs once every N assistant messages instead of every response. Default: 8."
    />
  );
}

export function IllustratorCadenceGroup({ editor, meta }: { editor: AgentEditorModel; meta: AgentRunIntervalMeta }) {
  return (
    <IntervalGroup
      editor={editor}
      label={meta.label}
      help={meta.help}
      unit={meta.unit}
      max={meta.max}
      placeholder={meta.defaultValue}
      note={`The Illustrator can only create a new image once every N assistant messages. If it decides not to draw, the timer does not reset. Default: ${meta.defaultValue}.`}
    />
  );
}
