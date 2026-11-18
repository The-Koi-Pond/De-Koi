import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import { generateConversationSchedules } from "../../../../../../engine/modes/chat/schedules/schedule.service";
import { maybeRefreshConversationStatusMessages } from "../../../../../../engine/modes/chat/status/status-message.service";
import { llmApi } from "../../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../../shared/api/storage-api";
import { filterLanguageGenerationConnections } from "../../../../../../shared/lib/connection-filters";
import { toUserMessage } from "../../../../../../shared/lib/error-message";
import { useUIStore } from "../../../../../../shared/stores/ui.store";
import { invalidateCharacterCollectionQueries } from "../../../../../catalog/characters/index";
import { chatKeys, useUpdateChat, useUpdateChatMetadata } from "../../../../../catalog/chats/index";
import { useConnections } from "../../../../../catalog/connections/index";
import { createChatSetupStartGate } from "../../lib/chat-setup-start";
import { SetupCharacterChips, SetupCharacterList } from "./SetupCharacterList";
import { SetupConnectionPicker } from "./SetupConnectionPicker";
import { SetupDialog } from "./SetupDialog";
import { SetupParametersPanel, useSetupParameters } from "./SetupParametersPanel";
import { SetupPersonaPicker } from "./SetupPersonaPicker";
import { SetupSwitch } from "./SetupSwitch";
import { firstUsableConnectionId, readSetupChat } from "./setup-chat";
import {
  SETUP_FIELD_LABEL_CLASS,
  SETUP_ICON_BUTTON_CLASS,
  SETUP_INPUT_CLASS,
  SETUP_PRIMARY_BUTTON_CLASS,
  SETUP_QUIET_BUTTON_CLASS,
  SETUP_SECTION_HEADING_CLASS,
} from "./setup-styles";
import { useSavedPick } from "./use-saved-pick";
import { useSetupCharacters } from "./use-setup-characters";

const READY_PAUSE_MS = 2_000;

type StartPhase = "idle" | "starting" | "scheduling" | "ready";

/**
 * The one-page card that sets up a new Conversation. Every pick saves to the draft chat at once; the switches and
 * custom parameters are saved when the user starts chatting.
 */
export function NewConversationCard({
  chat,
  onFinish,
  onCancel,
}: {
  chat: Chat;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const nameId = useId();
  const personaHeadingId = useId();
  const charactersHeadingId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const updateChat = useUpdateChat();
  const updateMetadata = useUpdateChatMetadata();
  const fields = readSetupChat(chat);
  const savedPrompt = useUIStore((state) => state.customConversationPrompt);

  const connectionsQuery = useConnections();
  const allConnections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const connections = useMemo(() => filterLanguageGenerationConnections(allConnections), [allConnections]);
  const [connectionId, setConnectionId] = useSavedPick(fields.connectionId);
  const [personaId, setPersonaId] = useSavedPick(fields.personaId);
  const connection = connections.find((candidate) => candidate.id === connectionId) ?? null;
  const parameters = useSetupParameters({ metadata: fields.metadata, isConversation: true, connection });

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameEditedRef = useRef(false);
  const shouldRename = useCallback(() => !nameEditedRef.current, []);
  const characters = useSetupCharacters({ chat: fields, addGreetings: false, shouldRename });

  const [autonomous, setAutonomous] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [phase, setPhase] = useState<StartPhase>("idle");
  const startGate = useMemo(() => createChatSetupStartGate(), []);
  const mountedRef = useRef(true);
  const readyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current);
    };
  }, []);

  // On open: carry the user's saved custom conversation prompt into this chat.
  const promptCarriedRef = useRef(false);
  useEffect(() => {
    if (promptCarriedRef.current) return;
    promptCarriedRef.current = true;
    if (savedPrompt?.trim()) updateMetadata.mutate({ id: fields.id, customSystemPrompt: savedPrompt });
  }, [fields.id, savedPrompt, updateMetadata]);

  // On open: a chat without a connection gets one that can reply, once the connections have loaded.
  const connectionPickedRef = useRef(false);
  useEffect(() => {
    if (connectionPickedRef.current || !connectionsQuery.data) return;
    connectionPickedRef.current = true;
    if (fields.connectionId) return;
    const picked = firstUsableConnectionId(connections);
    if (!picked) return;
    setConnectionId(picked);
    updateChat.mutate({ id: fields.id, connectionId: picked });
  }, [connections, connectionsQuery.data, fields.connectionId, fields.id, setConnectionId, updateChat]);

  const pickConnection = (next: string | null) => {
    setConnectionId(next);
    updateChat.mutate({ id: fields.id, connectionId: next });
  };

  const pickPersona = (next: string | null) => {
    setPersonaId(next);
    updateChat.mutate({ id: fields.id, personaId: next });
  };

  const commitName = () => {
    if (nameDraft === null) return;
    const name = nameDraft.trim();
    setNameDraft(null);
    if (!name || name === chat.name) return;
    nameEditedRef.current = true;
    updateChat.mutate({ id: fields.id, name });
  };

  const leaveTo = (panel: "connections" | "characters") => {
    useUIStore.getState().openRightPanel(panel);
    onCancel();
  };

  const busy = phase !== "idle";
  const canStart = Boolean(connectionId) && characters.selectedIds.length > 0 && !busy;

  const start = async () => {
    if (!canStart) return;
    const withSchedules = autonomous && schedule;
    const characterIds = characters.selectedIds;
    setPhase("starting");
    const result = await startGate({
      persistMetadata: () =>
        updateMetadata.mutateAsync({
          id: fields.id,
          autonomousMessages: autonomous,
          conversationSchedulesEnabled: withSchedules,
          chatParameters: parameters.chatParameters,
          ...(savedPrompt?.trim() ? { customSystemPrompt: savedPrompt } : {}),
        }),
      generateSchedules: withSchedules
        ? async () => {
            if (mountedRef.current) setPhase("scheduling");
            await generateConversationSchedules(
              { storage: storageApi, llm: llmApi },
              {
                chatId: fields.id,
                characterIds,
                scheduleGenerationPreferences: useUIStore.getState().scheduleGenerationPreferences,
              },
            );
            void queryClient.invalidateQueries({ queryKey: chatKeys.detail(fields.id) });
          }
        : null,
      refreshStatusMessages: async () => {
        const refresh = await maybeRefreshConversationStatusMessages(
          { storage: storageApi, llm: llmApi },
          { chatId: fields.id },
        );
        if (refresh.refreshed.length > 0) invalidateCharacterCollectionQueries(queryClient);
      },
      reportStatusRefreshFailure: (error) => {
        toast.error("Chat started, but character status blurbs couldn't be created.", {
          description: toUserMessage(error, { fallback: "You can still chat; the blurbs will try again later." }),
        });
      },
      finish: () => {
        if (!mountedRef.current) return;
        if (!withSchedules) {
          onFinish();
          return;
        }
        setPhase("ready");
        readyTimerRef.current = window.setTimeout(() => {
          readyTimerRef.current = null;
          if (mountedRef.current) onFinish();
        }, READY_PAUSE_MS);
      },
    });
    if (result.ok || "busy" in result) return;
    if (!mountedRef.current) return;
    toast.error(result.message);
    setPhase("idle");
  };

  const groupSize = characters.selectedIds.length;

  return (
    <SetupDialog titleId={titleId} initialFocusRef={searchRef} onDismiss={onCancel} onEscape={onCancel}>
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <MessageSquare size="1rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
        <h2 id={titleId} className="de-koi-display-title min-w-0 flex-1 truncate text-base font-bold">
          New conversation
        </h2>
        <button type="button" aria-label="Close" onClick={onCancel} className={SETUP_ICON_BUTTON_CLASS}>
          <X size="1rem" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
        <div>
          <label htmlFor={nameId} className={SETUP_FIELD_LABEL_CLASS}>
            Name
          </label>
          <input
            id={nameId}
            value={nameDraft ?? chat.name}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            className={SETUP_INPUT_CLASS}
          />
        </div>

        <SetupConnectionPicker
          connectionId={connectionId}
          connections={connections}
          savedConnections={allConnections}
          loading={connectionsQuery.isLoading}
          onChange={pickConnection}
          onSetUpConnection={() => leaveTo("connections")}
        />

        <section className="flex flex-col gap-2">
          <h3 id={personaHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
            Your persona
          </h3>
          <SetupPersonaPicker personaId={personaId} labelledBy={personaHeadingId} onPick={pickPersona} />
        </section>

        <section aria-labelledby={charactersHeadingId} className="flex flex-col gap-2">
          <h3 id={charactersHeadingId} className={SETUP_SECTION_HEADING_CLASS}>
            {groupSize >= 2 ? `Group chat · ${groupSize} members` : "Who do you want to message?"}
          </h3>
          <SetupCharacterChips characters={characters.selected} onRemove={characters.remove} />
          <SetupCharacterList
            enabled
            selectedIds={characters.selectedIds}
            noCharactersText="No characters yet. Create or import one before starting a conversation."
            allAddedText="All characters added."
            searchInputRef={searchRef}
            onAdd={(character) => void characters.add(character)}
            onCreated={(id, name) => void characters.addNamed(id, name)}
            onImport={() => useUIStore.getState().openModal("import-character")}
            onOpenCharacters={() => leaveTo("characters")}
          />
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] px-3 py-3">
          <SetupSwitch
            label="Autonomous messages"
            description="Characters can message you first when you're inactive"
            checked={autonomous}
            onChange={setAutonomous}
          />
          {autonomous && (
            <SetupSwitch
              label="Generate schedule"
              description="Optional routines for availability and delayed replies"
              checked={schedule}
              onChange={setSchedule}
            />
          )}
        </section>

        <SetupParametersPanel parameters={parameters} />
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
        {phase === "scheduling" || phase === "ready" ? (
          <p role="status" className="flex flex-1 items-center gap-2 text-xs text-[var(--muted-foreground)]">
            {phase === "scheduling" && <Loader2 size="0.85rem" aria-hidden="true" className="animate-spin" />}
            {phase === "scheduling"
              ? "Generating schedule(s)… hang tight!"
              : "Ready! Say hi to start the conversation."}
          </p>
        ) : (
          <>
            <button type="button" onClick={onFinish} disabled={busy} className={SETUP_QUIET_BUTTON_CLASS}>
              Skip
            </button>
            <button
              type="button"
              onClick={() => void start()}
              disabled={!canStart}
              className={SETUP_PRIMARY_BUTTON_CLASS}
            >
              {phase === "starting" && <Loader2 size="0.85rem" aria-hidden="true" className="animate-spin" />}
              {phase === "starting" ? "Starting..." : "Start chatting"}
            </button>
          </>
        )}
      </footer>
    </SetupDialog>
  );
}
