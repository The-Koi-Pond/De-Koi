import { Activity, BookOpen, ChevronDown, ChevronUp, Clock, FileText, Layers } from "lucide-react";
import { useId } from "react";
import type { AgentRunIntervalMeta } from "../../../../../shared/lib/agent-cadence";
import {
  getCadenceInputValue,
  parseOptionalCadenceInputValue,
  stepCadenceValue,
} from "../../../../../shared/lib/agent-cadence";
import {
  DEFAULT_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH,
  MAX_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH,
} from "../../../../../engine/contracts/constants/agent-activation";
import { cn } from "../../../../../shared/lib/utils";
import { readClampedCount, savedPhase, type CustomResultType } from "./agent-form";
import { FIELD, FieldGroup, NOTE, SMALL_LABEL, ToggleCard, UnitInput } from "./editor-parts";

const AMBER_NOTE = "text-[0.625rem] text-amber-400";

/** Number boxes are 7rem wide. */
const NUMBER_BOX = cn(FIELD, "w-28");
import type { AgentEditorModel } from "./use-agent-editor";

const RESULT_TYPES: ReadonlyArray<{ value: CustomResultType; label: string; description: string }> = [
  {
    value: "context_injection",
    label: "Context Injection",
    description: "Adds text context before generation, or records informational text after generation.",
  },
  {
    value: "text_rewrite",
    label: "Text Rewrite",
    description: 'Runs after the reply and expects JSON with "editedText" plus "changes" to replace the message.',
  },
];

/** A two-line pick card (result types). */
function PickCard(props: { active: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        "rounded-xl p-3 text-left ring-1 transition-all",
        props.active
          ? "bg-[var(--primary)]/10 text-[var(--foreground)] ring-[var(--primary)]"
          : "text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)]",
      )}
    >
      <span className="block text-xs font-semibold">{props.title}</span>
      <span className="mt-1 block text-[0.625rem] leading-tight">{props.description}</span>
    </button>
  );
}

export function ResultTypeGroup({ editor }: { editor: AgentEditorModel }) {
  const { resultType } = editor.form;
  return (
    <FieldGroup
      icon={FileText}
      label="Result Type"
      help="Controls how De-Koi interprets this custom agent's output. Use Text Rewrite for post-processing agents that edit the generated reply."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {RESULT_TYPES.map((option) => (
          <PickCard
            key={option.value}
            active={option.value === resultType}
            title={option.label}
            description={option.description}
            onClick={() =>
              editor.edit(
                option.value === "text_rewrite"
                  ? { resultType: option.value, phase: "post_processing" }
                  : { resultType: option.value },
              )
            }
          />
        ))}
      </div>
      {resultType === "text_rewrite" && (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-[0.625rem] text-amber-200">
          Text rewrite agents always save as Post-Processing. Their prompt should return JSON like{" "}
          <code className="mr-1 rounded bg-black/30 px-1 py-0.5 font-mono">
            {'{"editedText":"...","changes":[{"description":"..."}]}'}
          </code>
          .
        </p>
      )}
    </FieldGroup>
  );
}

export function resultTypeLabel(resultType: CustomResultType) {
  return RESULT_TYPES.find((option) => option.value === resultType)!.label;
}

/** Turn data shows for custom agents whose saved phase is Post-Processing. */
export function showsTurnData(editor: AgentEditorModel) {
  return editor.custom && savedPhase(editor.form, true) === "post_processing";
}

export function TurnDataGroup({ editor }: { editor: AgentEditorModel }) {
  const { includePreGenInjections, includeParallelResults } = editor.form;
  return (
    <FieldGroup
      icon={Layers}
      label="Turn Data Access"
      help="Optional current-turn data for custom post-processing agents. Existing agents stay isolated unless these are enabled."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ToggleCard
          on={includePreGenInjections}
          title="Pre-generation injections"
          description="Current-turn context injected before the reply."
          onToggle={() => editor.edit((current) => ({ includePreGenInjections: !current.includePreGenInjections }))}
        />
        <ToggleCard
          on={includeParallelResults}
          title="Parallel agent results"
          description="Results from agents that ran alongside the reply."
          onToggle={() => editor.edit((current) => ({ includeParallelResults: !current.includeParallelResults }))}
        />
      </div>
    </FieldGroup>
  );
}

export function LorebookWriterGroup({ editor }: { editor: AgentEditorModel }) {
  const id = useId();
  const { lorebookWriteEnabled, writableLorebookId } = editor.form;
  const lorebooks = editor.lorebooksQuery.data;
  // A list that hasn't loaded (also one that failed) reads as still loading.
  const isLoading = !lorebooks;
  const loadedEmpty = !!lorebooks && lorebooks.length === 0;
  const missing =
    !!lorebooks && !!writableLorebookId && !lorebooks.some((lorebook) => lorebook.id === writableLorebookId);
  return (
    <FieldGroup
      icon={BookOpen}
      label="Lorebook Writer"
      help="Allows this custom agent to create or update entries in one selected lorebook."
    >
      <ToggleCard
        on={lorebookWriteEnabled}
        title={lorebookWriteEnabled ? "Enabled" : "Disabled"}
        description={
          lorebookWriteEnabled
            ? "The agent can save durable facts to the selected lorebook."
            : "The write tool stays unavailable to this agent."
        }
        disabled={!lorebookWriteEnabled && loadedEmpty}
        onToggle={() => editor.edit((current) => ({ lorebookWriteEnabled: !current.lorebookWriteEnabled }))}
      />
      <div className="pt-1">
        <label htmlFor={id} className={SMALL_LABEL}>
          Target lorebook
        </label>
        <select
          id={id}
          value={writableLorebookId}
          disabled={!lorebookWriteEnabled || isLoading || loadedEmpty}
          onChange={(event) => editor.edit({ writableLorebookId: event.target.value })}
          className={FIELD}
        >
          <option value="">{isLoading ? "Loading lorebooks..." : "Select a lorebook"}</option>
          {missing && <option value={writableLorebookId}>Missing lorebook ({writableLorebookId})</option>}
          {(lorebooks ?? []).map((lorebook) => (
            <option key={lorebook.id} value={lorebook.id}>
              {lorebook.name || "Untitled lorebook"}
            </option>
          ))}
        </select>
      </div>
      {loadedEmpty && <p className={NOTE}>Create a lorebook before enabling writes for this agent.</p>}
      {lorebookWriteEnabled && missing && (
        <p className={AMBER_NOTE}>
          The saved target lorebook is no longer available. Select another lorebook before saving.
        </p>
      )}
    </FieldGroup>
  );
}

export function CustomCadenceGroup({ editor, meta }: { editor: AgentEditorModel; meta: AgentRunIntervalMeta }) {
  const id = useId();
  const focused = editor.cadenceFocused;
  const setFocused = editor.setCadenceFocused;
  const value = editor.form.runInterval as number | "";
  const step = (delta: number) =>
    editor.edit((current) => ({ runInterval: stepCadenceValue(current.runInterval as number | "", delta, meta.max) }));
  return (
    <FieldGroup icon={Clock} label={meta.label} htmlFor={id} help={meta.help}>
      <UnitInput unit={meta.unit}>
        <div className="relative w-28">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            value={focused ? String(value) : getCadenceInputValue(value)}
            onFocus={(event) => {
              setFocused(true);
              event.target.select();
            }}
            onBlur={() => setFocused(false)}
            onChange={(event) =>
              editor.edit({ runInterval: parseOptionalCadenceInputValue(event.target.value, meta.max) })
            }
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              step(event.key === "ArrowUp" ? 1 : -1);
            }}
            className={cn(FIELD, "pr-7")}
          />
          <div className="absolute inset-y-1 right-1 flex flex-col">
            <button
              type="button"
              aria-label="Increase trigger cadence"
              onClick={() => step(1)}
              className="flex flex-1 items-center rounded px-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <ChevronUp size="0.75rem" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Decrease trigger cadence"
              onClick={() => step(-1)}
              className="flex flex-1 items-center rounded px-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <ChevronDown size="0.75rem" aria-hidden="true" />
            </button>
          </div>
        </div>
      </UnitInput>
    </FieldGroup>
  );
}

export function ActivationKeywordsGroup({ editor }: { editor: AgentEditorModel }) {
  const keywordsId = useId();
  const depthId = useId();
  const { activationKeywords, activationScanDepth } = editor.form;
  return (
    <FieldGroup
      icon={Activity}
      label="Activation Keywords"
      help="When keywords are set, this custom agent is skipped unless at least one keyword appears in the recent chat messages it scans."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={keywordsId} className={SMALL_LABEL}>
            Keywords
          </label>
          <textarea
            id={keywordsId}
            rows={4}
            value={activationKeywords}
            onChange={(event) => editor.edit({ activationKeywords: event.target.value })}
            placeholder={"tavern\nsecret door\nmoonlit ritual"}
            className={cn(FIELD, "resize-y")}
          />
        </div>
        <div>
          <label htmlFor={depthId} className={SMALL_LABEL}>
            Scan Depth
          </label>
          <UnitInput unit="messages">
            <input
              id={depthId}
              type="number"
              min={1}
              max={MAX_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH}
              value={activationScanDepth}
              placeholder={String(DEFAULT_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH)}
              onChange={(event) =>
                editor.edit({
                  activationScanDepth: readClampedCount(event.target.value, MAX_CUSTOM_AGENT_ACTIVATION_SCAN_DEPTH),
                })
              }
              className={NUMBER_BOX}
            />
          </UnitInput>
        </div>
      </div>
      <p className={NOTE}>Leave keywords empty to run this custom agent on its normal cadence.</p>
    </FieldGroup>
  );
}
