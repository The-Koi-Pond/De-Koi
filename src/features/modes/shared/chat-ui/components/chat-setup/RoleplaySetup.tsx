import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import { ROLEPLAY_STARTER_CHARACTERS } from "../../../../../../engine/modes/roleplay/starter-characters";
import { filterLanguageGenerationConnections } from "../../../../../../shared/lib/connection-filters";
import { toUserMessage } from "../../../../../../shared/lib/error-message";
import { cn } from "../../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../../shared/stores/ui.store";
import {
  RoleplayWorkflowProfileChooser,
  useApplyChatPreset,
  type ApplyPendingRoleplayWorkflow,
} from "../../../../../catalog/chat-presets/index";
import { useUpdateChat, useUpdateChatMetadata } from "../../../../../catalog/chats/index";
import { useConnections, type ConnectionSummary } from "../../../../../catalog/connections/index";
import {
  ChoiceSelectionModal,
  useDefaultPresetSummary,
  usePresetFull,
  usePresetSummaries,
} from "../../../../../catalog/presets/index";
import { metadataChoiceSelections } from "../../lib/chat-settings-metadata";
import { CampaignSetupCard } from "./CampaignSetupCard";
import { QuickSetupCard } from "./QuickSetupCard";
import { SetupCharacterList, SetupCharacterRows } from "./SetupCharacterList";
import { SetupConnectionPicker } from "./SetupConnectionPicker";
import { SetupDialog } from "./SetupDialog";
import { SetupLorebookStep } from "./SetupLorebookStep";
import { SetupParametersPanel, useSetupParameters, type SetupParameters } from "./SetupParametersPanel";
import { SetupPersonaPicker } from "./SetupPersonaPicker";
import { readSetupChat, type SetupChatFields } from "./setup-chat";
import {
  SETUP_FIELD_LABEL_CLASS,
  SETUP_ICON_BUTTON_CLASS,
  SETUP_PRIMARY_BUTTON_CLASS,
  SETUP_QUIET_BUTTON_CLASS,
  SETUP_SELECT_CLASS,
} from "./setup-styles";
import { useSavedPick } from "./use-saved-pick";
import { useSetupCharacters, type SetupCharacters } from "./use-setup-characters";

const STEPS = [
  {
    key: "connection",
    title: "Choose a connection",
    help: "Which AI provider should this chat use? If you haven't set one up yet, you can do that from the Connections panel.",
  },
  {
    key: "preset",
    title: "Pick a preset",
    help: "A preset is the set of writing instructions the AI follows. The default works well for most chats, so you can just press Next.",
  },
  {
    key: "persona",
    title: "Select your persona",
    help: "Your persona tells the AI who you are. Pick one or skip to stay anonymous.",
  },
  {
    key: "characters",
    title: "Add characters",
    help: "Characters bring your chat to life! Add one or more characters for the AI to roleplay as.",
  },
  {
    key: "lorebooks",
    title: "Attach lorebooks",
    help: "Lorebooks are notes about your world (places, people, history) that the AI reads when they come up. Optional, so you can press Next.",
  },
  {
    key: "workflow",
    title: "Choose a workflow profile",
    help: "Optional extras for longer or more visual stories. Simple Roleplay is already on, so press Done to start chatting. Pick another to add its extras; the button then says Apply & finish.",
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const RENAME_ALWAYS = () => true;

function readLorebookIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

/**
 * Setup for every mode but Conversation: six steps that each save at once, with Quick setup one click away.
 * Custom parameters are saved by Done, and a picked workflow profile is applied before it finishes.
 */
export function RoleplaySetup({
  chat,
  startInQuickSetup,
  onFinish,
  onCancel,
}: {
  chat: Chat;
  startInQuickSetup: boolean;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const fields = readSetupChat(chat);
  const updateChat = useUpdateChat();
  const updateMetadata = useUpdateChatMetadata();
  const applyChatPreset = useApplyChatPreset();

  const [view, setView] = useState<"steps" | "quick" | "campaign">(startInQuickSetup ? "quick" : "steps");
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex]!;
  const isLastStep = stepIndex === STEPS.length - 1;

  const connectionsQuery = useConnections();
  const allConnections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const connections = useMemo(() => filterLanguageGenerationConnections(allConnections), [allConnections]);
  const [connectionId, setConnectionId] = useSavedPick(fields.connectionId);
  const [personaId, setPersonaId] = useSavedPick(fields.personaId);
  const [presetId, setPresetId] = useSavedPick(fields.promptPresetId);
  const connection = connections.find((candidate) => candidate.id === connectionId) ?? null;
  const parameters = useSetupParameters({ metadata: fields.metadata, isConversation: false, connection });
  const characters = useSetupCharacters({ chat: fields, addGreetings: true, shouldRename: RENAME_ALWAYS });

  const presetsQuery = usePresetSummaries();
  const presetDetails = usePresetFull(step.key === "preset" ? presetId : null);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [pendingProfileApply, setPendingProfileApply] = useState<ApplyPendingRoleplayWorkflow | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Quick setup: only the newest apply may finish setup, and a second can't start while one is still running.
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const applyTokenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // On open: a chat without a prompt preset gets the default one.
  const defaultPresetQuery = useDefaultPresetSummary();
  const presetPickedRef = useRef(false);
  useEffect(() => {
    // Undefined while loading; null once loaded when there is no default preset.
    if (presetPickedRef.current || defaultPresetQuery.data === undefined) return;
    presetPickedRef.current = true;
    const defaultPresetId = defaultPresetQuery.data?.id;
    if (fields.promptPresetId || !defaultPresetId) return;
    setPresetId(defaultPresetId);
    updateChat.mutate({ id: fields.id, promptPresetId: defaultPresetId });
  }, [defaultPresetQuery.data, fields.id, fields.promptPresetId, setPresetId, updateChat]);

  const holdPendingProfileApply = useCallback((apply: ApplyPendingRoleplayWorkflow | null) => {
    setPendingProfileApply(() => apply);
  }, []);

  const goToStep = (index: number) => {
    // The workflow chooser reports its pending pick while it is shown; leaving the step drops it.
    if (STEPS[stepIndex]?.key === "workflow") setPendingProfileApply(null);
    setStepIndex(index);
  };

  const leaveTo = (panel: "connections" | "characters") => {
    useUIStore.getState().openRightPanel(panel);
    onCancel();
  };

  const pickConnection = (next: string | null) => {
    setConnectionId(next);
    updateChat.mutate({ id: fields.id, connectionId: next });
  };

  const pickPersona = (next: string | null) => {
    setPersonaId(next);
    updateChat.mutate({ id: fields.id, personaId: next });
  };

  const pickPreset = (next: string | null) => {
    setPresetId(next);
    updateChat.mutate({ id: fields.id, promptPresetId: next });
  };

  const presetDetailsLoading = step.key === "preset" && !!presetId && presetDetails.isLoading;

  const next = () => {
    if (step.key === "preset" && presetId) {
      if (presetDetails.isLoading) return;
      if ((presetDetails.data?.choiceBlocks.length ?? 0) > 0) {
        setChoicesOpen(true);
        return;
      }
    }
    goToStep(stepIndex + 1);
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      if (pendingProfileApply && !(await pendingProfileApply())) return;
      await updateMetadata.mutateAsync({ id: fields.id, chatParameters: parameters.chatParameters });
      if (mountedRef.current) onFinish();
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: "Couldn't finish setup. Try again." }));
    } finally {
      if (mountedRef.current) setFinishing(false);
    }
  };

  /** Stops waiting for a running Quick setup apply: its result no longer finishes setup. */
  const detachApply = () => {
    applyTokenRef.current += 1;
  };

  const applyQuickSetup = async (chatPresetId: string) => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    const token = ++applyTokenRef.current;
    try {
      await applyChatPreset.mutateAsync({ presetId: chatPresetId, chatId: fields.id });
      if (mountedRef.current && token === applyTokenRef.current) onFinish();
    } catch (error) {
      if (mountedRef.current && token === applyTokenRef.current) {
        toast.error(toUserMessage(error, { fallback: "Couldn't apply the chat preset. Try again." }));
      }
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  };

  const backToSteps = () => {
    detachApply();
    setView("steps");
  };

  const closeQuickSetup = () => {
    detachApply();
    onCancel();
  };

  // Escape: back out of Quick setup or the campaign card, leave the choice modal to handle its own, otherwise close.
  const onEscape = choicesOpen ? undefined : view === "steps" ? onCancel : backToSteps;

  return (
    <>
      <SetupDialog
        titleId={titleId}
        wide={view === "steps" && step.key === "workflow"}
        refocusKey={`${view}:${step.key}`}
        onDismiss={view === "quick" ? closeQuickSetup : onCancel}
        onEscape={onEscape}
      >
        {view === "campaign" ? (
          <CampaignSetupCard
            titleId={titleId}
            connectionId={connectionId}
            connections={connections}
            allConnections={allConnections}
            connectionsLoading={connectionsQuery.isLoading}
            personaId={personaId}
            folderId={chat.folderId ?? null}
            onPickConnection={pickConnection}
            onPickPersona={pickPersona}
            onSetUpConnection={() => leaveTo("connections")}
            initialCharacterIds={fields.characterIds}
            initialLorebookIds={readLorebookIds(fields.metadata.activeLorebookIds)}
            onImportCharacter={() => useUIStore.getState().openModal("import-character")}
            onOpenCharacters={() => leaveTo("characters")}
            onBack={backToSteps}
            onClose={onCancel}
          />
        ) : view === "quick" ? (
          <QuickSetupCard
            titleId={titleId}
            fields={fields}
            personaId={personaId}
            characters={characters}
            applying={applying}
            onPickPersona={pickPersona}
            onApply={(chatPresetId) => void applyQuickSetup(chatPresetId)}
            onBack={backToSteps}
            onClose={closeQuickSetup}
            onOpenCharacters={() => {
              detachApply();
              leaveTo("characters");
            }}
          />
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-5">
              <header className="flex items-start gap-3">
                <img src="/koi-mark.svg" alt="" aria-hidden="true" className="mt-0.5 h-8 w-8 shrink-0" />
                <div className="min-w-0">
                  <h2 id={titleId} className="de-koi-display-title text-base font-bold">
                    {step.title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{step.help}</p>
                </div>
              </header>
              <RoleplayStepBody
                stepKey={step.key}
                titleId={titleId}
                chat={chat}
                fields={fields}
                connectionId={connectionId}
                connections={connections}
                allConnections={allConnections}
                connectionsLoading={connectionsQuery.isLoading}
                parameters={parameters}
                presetId={presetId}
                presets={presetsQuery.data ?? []}
                presetsLoading={!presetsQuery.data}
                personaId={personaId}
                characters={characters}
                onPickConnection={pickConnection}
                onPickPreset={pickPreset}
                onPickPersona={pickPersona}
                onLeaveTo={leaveTo}
                onNavigateAway={onCancel}
                onPendingProfileApplyChange={holdPendingProfileApply}
              />
            </div>
            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] px-3 py-3">
              <StepDots current={stepIndex} />
              <div className="ml-auto flex items-center gap-1.5">
                {stepIndex > 0 && (
                  <button
                    type="button"
                    aria-label="Back"
                    onClick={() => goToStep(stepIndex - 1)}
                    className={SETUP_ICON_BUTTON_CLASS}
                  >
                    <ArrowLeft size="1rem" aria-hidden="true" />
                  </button>
                )}
                <button type="button" onClick={onFinish} className={SETUP_QUIET_BUTTON_CLASS}>
                  Skip
                </button>
                <button
                  type="button"
                  aria-label="Play a campaign"
                  onClick={() => setView("campaign")}
                  className={SETUP_QUIET_BUTTON_CLASS}
                >
                  <ScrollText size="0.85rem" aria-hidden="true" />
                  <span className="hidden sm:inline">Play a campaign</span>
                  <span className="sm:hidden">Campaign</span>
                </button>
                <button
                  type="button"
                  aria-label="Use settings presets"
                  onClick={() => setView("quick")}
                  className={SETUP_QUIET_BUTTON_CLASS}
                >
                  <span className="hidden sm:inline">Use settings presets</span>
                  <span className="sm:hidden">Presets</span>
                </button>
                {step.key === "characters" && characters.selected.length > 0 ? (
                  <>
                    {/* With a character added, the rest (lorebooks, workflow extras) is optional: start right away (#1784). */}
                    <button type="button" aria-label="More options" onClick={next} className={SETUP_QUIET_BUTTON_CLASS}>
                      <span className="hidden sm:inline">More options</span>
                      <span className="sm:hidden">More</span>
                    </button>
                    <button
                      type="button"
                      disabled={finishing}
                      onClick={() => void finish()}
                      className={SETUP_PRIMARY_BUTTON_CLASS}
                    >
                      {finishing && <Loader2 size="0.85rem" aria-hidden="true" className="animate-spin" />}
                      Start chatting
                    </button>
                  </>
                ) : isLastStep ? (
                  <button
                    type="button"
                    disabled={finishing}
                    onClick={() => void finish()}
                    className={SETUP_PRIMARY_BUTTON_CLASS}
                  >
                    {finishing && <Loader2 size="0.85rem" aria-hidden="true" className="animate-spin" />}
                    {pendingProfileApply ? "Apply & finish" : "Done"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={presetDetailsLoading}
                    onClick={next}
                    className={SETUP_PRIMARY_BUTTON_CLASS}
                  >
                    {presetDetailsLoading && <Loader2 size="0.85rem" aria-hidden="true" className="animate-spin" />}
                    Next
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </SetupDialog>
      {choicesOpen && presetId && (
        <ChoiceSelectionModal
          open
          presetId={presetId}
          chatId={fields.id}
          existingChoices={metadataChoiceSelections(fields.metadata.presetChoices)}
          onClose={() => {
            setChoicesOpen(false);
            goToStep(stepIndex + 1);
          }}
        />
      )}
    </>
  );
}

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="sr-only">
        Step {current + 1} of {STEPS.length}
      </span>
      {STEPS.map((step, index) => (
        <span
          key={step.key}
          aria-hidden="true"
          className={cn(
            "h-1.5 rounded-full transition-all",
            index === current
              ? "w-5 bg-[var(--primary)]"
              : index < current
                ? "w-1.5 bg-[var(--primary)]/60"
                : "w-1.5 bg-[var(--border)]",
          )}
        />
      ))}
    </div>
  );
}

function RoleplayStepBody({
  stepKey,
  titleId,
  chat,
  fields,
  connectionId,
  connections,
  allConnections,
  connectionsLoading,
  parameters,
  presetId,
  presets,
  presetsLoading,
  personaId,
  characters,
  onPickConnection,
  onPickPreset,
  onPickPersona,
  onLeaveTo,
  onNavigateAway,
  onPendingProfileApplyChange,
}: {
  stepKey: StepKey;
  titleId: string;
  chat: Chat;
  fields: SetupChatFields;
  connectionId: string | null;
  connections: readonly ConnectionSummary[];
  allConnections: readonly ConnectionSummary[];
  connectionsLoading: boolean;
  parameters: SetupParameters;
  presetId: string | null;
  presets: ReadonlyArray<{ id: string; name: string }>;
  presetsLoading: boolean;
  personaId: string | null;
  characters: SetupCharacters;
  onPickConnection: (connectionId: string | null) => void;
  onPickPreset: (presetId: string | null) => void;
  onPickPersona: (personaId: string | null) => void;
  onLeaveTo: (panel: "connections" | "characters") => void;
  /** The workflow chooser opened another surface itself; setup only closes. */
  onNavigateAway: () => void;
  onPendingProfileApplyChange: (apply: ApplyPendingRoleplayWorkflow | null) => void;
}) {
  const presetSelectId = useId();

  switch (stepKey) {
    case "connection":
      return (
        <div className="flex flex-col gap-3">
          <SetupConnectionPicker
            connectionId={connectionId}
            connections={connections}
            savedConnections={allConnections}
            loading={connectionsLoading}
            onChange={onPickConnection}
            onSetUpConnection={() => onLeaveTo("connections")}
          />
          <SetupParametersPanel parameters={parameters} />
        </div>
      );
    case "preset":
      return (
        <div>
          <label htmlFor={presetSelectId} className={SETUP_FIELD_LABEL_CLASS}>
            Prompt preset
          </label>
          <select
            id={presetSelectId}
            value={presetId ?? ""}
            disabled={presetsLoading}
            onChange={(event) => onPickPreset(event.target.value || null)}
            className={SETUP_SELECT_CLASS}
          >
            <option value="">None</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
      );
    case "persona":
      return <SetupPersonaPicker personaId={personaId} labelledBy={titleId} onPick={onPickPersona} />;
    case "characters":
      return (
        <div className="flex flex-col gap-2">
          <SetupCharacterRows characters={characters.selected} onRemove={characters.remove} />
          <SetupCharacterList
            enabled
            selectedIds={characters.selectedIds}
            noCharactersText="No characters yet. Pick one to start with, or make or import your own."
            allAddedText="Everyone in your library is in this chat."
            starters={ROLEPLAY_STARTER_CHARACTERS}
            onAdd={(character) => void characters.add(character)}
            onCreated={(id, name) => void characters.addNamed(id, name)}
            onImport={() => useUIStore.getState().openModal("import-character")}
            onOpenCharacters={() => onLeaveTo("characters")}
          />
        </div>
      );
    case "lorebooks":
      return (
        <SetupLorebookStep chat={chat} fields={fields} characterIds={characters.selectedIds} personaId={personaId} />
      );
    case "workflow":
      return (
        <RoleplayWorkflowProfileChooser
          chat={chat}
          entryPoint="wizard"
          onNavigateAway={onNavigateAway}
          onPendingApplyChange={onPendingProfileApplyChange}
        />
      );
  }
}
