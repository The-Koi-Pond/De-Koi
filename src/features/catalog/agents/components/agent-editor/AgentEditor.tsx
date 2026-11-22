import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { SaveErrorBanner, UnsavedChangesBar } from "../../../../../shared/components/ui/ExplicitSaveChrome";
import { AgentEditorHeader } from "./AgentEditorHeader";
import { BudgetGroup, IllustratorCadenceGroup, KeeperRunIntervalGroup, TriggersAfterGroup } from "./BudgetGroups";
import {
  ActivationKeywordsGroup,
  CustomCadenceGroup,
  LorebookWriterGroup,
  ResultTypeGroup,
  TurnDataGroup,
  resultTypeLabel,
  showsTurnData,
} from "./CustomAgentGroups";
import {
  AuthorGroup,
  ConnectionGroup,
  DescriptionGroup,
  PhaseGroup,
  PromptSectionGroup,
  StatusGroup,
  NO_PHASE_NOTE,
  phaseInfo,
} from "./GeneralGroups";
import { BackgroundImageGroup, IllustratorImageGroup, NpcAvatarsGroup } from "./ImageGroups";
import { KnowledgeSourcesGroup } from "./KnowledgeSourcesGroup";
import { PromptTemplateGroup } from "./PromptTemplateGroup";
import { ToolsGroup } from "./ToolsGroup";
import { useAgentEditor, type AgentEditorModel } from "./use-agent-editor";

/** The full-page editor for the agent in the UI store's `agentDetailId` (`__new__` for a new custom agent). */
export function AgentEditor() {
  const editor = useAgentEditor();

  if (!editor.found) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Agent not found.
      </div>
    );
  }

  const { custom, isType } = editor;
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <AgentEditorHeader editor={editor} />
      {editor.leaving && (
        <UnsavedChangesBar
          saving={editor.saving}
          onKeepEditing={editor.keepEditing}
          onDiscard={editor.discard}
          onSaveAndClose={editor.saveAndClose}
        />
      )}
      <SaveErrorBanner error={editor.saveError} onDismiss={editor.dismissError} />
      {editor.otherKnowledgeAgent && (
        <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <AlertCircle size="0.8125rem" className="shrink-0" aria-hidden="true" />
          <span>
            {editor.otherKnowledgeAgent} is also configured. Both agents will run before generation and may inject
            overlapping context. Consider disabling one for cleaner prompts.
          </span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6 max-md:p-4">
        <div className="mx-auto max-w-3xl space-y-6">
          <DescriptionGroup editor={editor} />
          <AuthorGroup editor={editor} />
          <StatusGroup editor={editor} />
          <PhaseGroup editor={editor} />
          {custom && <ResultTypeGroup editor={editor} />}
          {showsTurnData(editor) && <TurnDataGroup editor={editor} />}
          {custom && <LorebookWriterGroup editor={editor} />}
          <ConnectionGroup editor={editor} />
          {isType("illustrator") && <IllustratorImageGroup editor={editor} />}
          {isType("character-tracker") && <NpcAvatarsGroup editor={editor} />}
          {isType("background") && <BackgroundImageGroup editor={editor} />}
          <BudgetGroup editor={editor} />
          {custom && editor.customCadence && <CustomCadenceGroup editor={editor} meta={editor.customCadence} />}
          {custom && <ActivationKeywordsGroup editor={editor} />}
          {isType("chat-summary") && <TriggersAfterGroup editor={editor} />}
          {isType("lorebook-keeper") && <KeeperRunIntervalGroup editor={editor} />}
          {isType("illustrator") && editor.builtInCadence && (
            <IllustratorCadenceGroup editor={editor} meta={editor.builtInCadence} />
          )}
          <PromptSectionGroup editor={editor} />
          {(isType("knowledge-retrieval") || isType("knowledge-router")) && <KnowledgeSourcesGroup editor={editor} />}
          <PromptTemplateGroup editor={editor} />
          <ToolsGroup editor={editor} />
          <AboutCard editor={editor} />
        </div>
      </div>
    </div>
  );
}

function AboutCard({ editor }: { editor: AgentEditorModel }) {
  const { form, row } = editor;
  const phase = phaseInfo(form.phase);
  return (
    <section className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
      <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">About this Agent</h3>
      <dl className="space-y-2 text-xs text-[var(--muted-foreground)]">
        <AboutLine term="Type:">{editor.custom && row ? "Custom" : editor.agentDetailId}</AboutLine>
        <AboutLine term="Phase:">{phase ? `${phase.label} — ${phase.description}` : NO_PHASE_NOTE}</AboutLine>
        {editor.custom && <AboutLine term="Result Type:">{resultTypeLabel(form.resultType)}</AboutLine>}
        <AboutLine term="DB Status:">
          {row ? `Persisted (ID: ${row.id})` : "Not yet saved — click Save to persist"}
        </AboutLine>
      </dl>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">Add this agent to a Roleplay chat to use it.</p>
    </section>
  );
}

function AboutLine({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt className="font-bold text-[var(--foreground)]">{term}</dt> <dd className="min-w-0">{children}</dd>
    </div>
  );
}
