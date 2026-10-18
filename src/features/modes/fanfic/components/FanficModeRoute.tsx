import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useUpdateChatMetadata } from "../../../catalog/chats/index";
import type { FanficOutline, FanficState, FanficVoiceSheet } from "../../../../engine/contracts/types/fanfic";
import { fanficVoiceCharacters, withFanficVoices } from "../../../../engine/modes/fanfic/voices";
import { approveFanficOutline } from "../../../../engine/modes/fanfic/outline";
import { withFanficResearchNotes } from "../../../../engine/modes/fanfic/research";
import { defaultFanficRequest, fanficStage } from "../../../../engine/modes/fanfic/request";
import { useChatStore } from "../../../../shared/stores/chat.store";
import {
  useFanficChat,
  useFanficGenerationState,
  useFanficEditor,
  useFanficLedger,
  useFanficVoices,
  useFanficOutline,
  useFanficRequestSave,
  useFanficWriter,
  type FanficWriteArgs,
} from "../hooks/use-fanfic";
import { FanficOutlineReview, FanficPlanning } from "./FanficOutlineView";
import { FanficVoicesPanel } from "./FanficVoicesPanel";
import { FanficReader } from "./FanficReader";
import { FanficRequestForm, type FanficRequestSubmit } from "./FanficRequestForm";

export interface FanficModeRouteProps {
  activeChatId: string;
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  return error instanceof Error ? error.message : String(error);
}

export function FanficModeRoute({ activeChatId }: FanficModeRouteProps) {
  const { chat, state, chapters, isLoading, messagesComplete, error } = useFanficChat(activeChatId);
  const generation = useFanficGenerationState(activeChatId);
  const updateMetadata = useUpdateChatMetadata();
  const saveRequest = useFanficRequestSave(activeChatId);
  const outline = useFanficOutline(activeChatId);
  const connectionId = chat?.connectionId ?? null;
  const write = useFanficWriter(activeChatId, connectionId);
  const ledger = useFanficLedger(activeChatId, connectionId);
  const { update: updateLedger } = ledger;
  const voices = useFanficVoices(activeChatId, connectionId);
  const editor = useFanficEditor(activeChatId, connectionId);
  const [editingRequest, setEditingRequest] = useState(false);
  const outlineAbort = useRef<AbortController | null>(null);
  const lastWrite = useRef<FanficWriteArgs>({ kind: "chapter" });
  const stage = fanficStage(state);

  useEffect(() => {
    if (chat) useChatStore.getState().setActiveChat(chat);
  }, [chat]);

  // New-chat setup opens the shared settings drawer and wizard in other modes; here the request form is the setup.
  useEffect(() => {
    useChatStore.getState().consumeNewChatSetupIntent(activeChatId);
  }, [activeChatId]);

  const runWrite = useCallback(
    (args: FanficWriteArgs) => {
      lastWrite.current = args;
      // Keep the story ledger current behind the scenes; it skips itself while the fic doesn't need one.
      void write(args).then((written) => {
        if (written) updateLedger({ quiet: true });
      });
    },
    [updateLedger, write],
  );

  const chapterCount = useRef(chapters.length);
  useEffect(() => {
    chapterCount.current = chapters.length;
  }, [chapters.length]);
  const startOutline = useCallback(
    (nextConnectionId: string | null) => {
      outlineAbort.current?.abort();
      const controller = new AbortController();
      outlineAbort.current = controller;
      outline.mutate(
        { connectionId: nextConnectionId, signal: controller.signal },
        {
          // With outline review skipped the plan arrives approved: go straight to chapter 1.
          onSuccess: (planned) => {
            if (planned.outlineApproved && chapterCount.current === 0) runWrite({ kind: "chapter" });
          },
        },
      );
    },
    [outline, runWrite],
  );

  // The only place planning starts: a saved request with no outline yet (fresh submit, or a reload
  // mid-plan) plans once per submit. It waits for the request save, so the planner reads the new request.
  const [planToken, setPlanToken] = useState(0);
  const planningStartedFor = useRef<string | null>(null);
  const savingRequest = saveRequest.isPending;
  useEffect(() => {
    if (stage !== "outline" || editingRequest || savingRequest || outline.isPending || outline.isError) return;
    const key = `${activeChatId}:${planToken}`;
    if (planningStartedFor.current === key) return;
    planningStartedFor.current = key;
    startOutline(connectionId);
  }, [
    activeChatId,
    connectionId,
    editingRequest,
    outline.isError,
    outline.isPending,
    planToken,
    savingRequest,
    stage,
    startOutline,
  ]);

  useEffect(() => () => outlineAbort.current?.abort(), []);

  const saveState = (next: FanficState) => updateMetadata.mutateAsync({ id: activeChatId, fanfic: next });

  // Planning starts from the effect above once the saved request is back in the chat cache.
  const submitRequest = (value: FanficRequestSubmit) => {
    outlineAbort.current?.abort();
    outline.reset();
    saveRequest.mutate(value, {
      onSuccess: () => {
        setPlanToken((token) => token + 1);
        setEditingRequest(false);
      },
    });
  };

  const approveOutline = async (approved: FanficOutline, researchNotes: string | null) => {
    if (!state) return;
    let next: FanficState;
    try {
      next = withFanficResearchNotes(approveFanficOutline(state, approved), researchNotes);
    } catch {
      toast.error("Give every chapter a title or some beats before writing.");
      return;
    }
    try {
      await saveState(next);
    } catch (error) {
      toast.error(errorText(error) ?? "The outline could not be saved.");
      return;
    }
    if (chapters.length === 0) runWrite({ kind: "chapter" });
  };

  const saveVoices = async (sheets: FanficVoiceSheet[]) => {
    if (!state) return;
    try {
      await saveState(withFanficVoices(state, sheets));
      toast.success("Voice sheets saved. The next chapter uses them.");
    } catch (error) {
      toast.error(errorText(error) ?? "The voice sheets could not be saved.");
    }
  };

  const replan = () => {
    outline.reset();
    startOutline(connectionId);
  };

  if (error && !chat) {
    return (
      <div role="alert" className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--muted-foreground)]">
        {errorText(error) ?? "This fic could not be opened."}
      </div>
    );
  }

  if (isLoading || !chat || !messagesComplete) {
    return (
      <div className="flex flex-1 items-center justify-center p-6" role="status" aria-label="Opening fic">
        <Loader2 size="1.5rem" className="animate-spin text-[var(--primary)]" aria-hidden="true" />
      </div>
    );
  }

  const showForm = stage === "request" || editingRequest;
  const planning = !showForm && (stage === "outline" || outline.isPending);

  return (
    <div
      data-component="FanficModeRoute"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-5 sm:py-5"
    >
      {showForm ? (
        <FanficRequestForm
          initialRequest={state?.request ?? defaultFanficRequest()}
          initialConnectionId={connectionId}
          initialCharacterIds={Array.isArray(chat.characterIds) ? chat.characterIds : []}
          submitting={saveRequest.isPending}
          submitError={errorText(saveRequest.error)}
          onSubmit={submitRequest}
          onCancel={editingRequest && state?.outline ? () => setEditingRequest(false) : undefined}
        />
      ) : planning || !state ? (
        <FanficPlanning
          phase={outline.phase}
          error={errorText(outline.error)}
          onRetry={replan}
          onCancel={() => {
            outlineAbort.current?.abort();
            setEditingRequest(true);
          }}
          onEditRequest={() => setEditingRequest(true)}
        />
      ) : stage === "outline_review" && state.outline ? (
        <FanficOutlineReview
          key={JSON.stringify(state.outline)}
          outline={state.outline}
          research={state.research}
          voicesPanel={
            <FanficVoicesPanel
              voices={state.voices ?? []}
              controller={voices}
              canBuild={fanficVoiceCharacters(state.request).length > 0}
              busy={updateMetadata.isPending}
              onSave={saveVoices}
            />
          }
          saving={updateMetadata.isPending}
          onApprove={(approved, notes) => void approveOutline(approved, notes)}
          onReplan={replan}
          onEditRequest={() => setEditingRequest(true)}
        />
      ) : (
        <FanficReader
          chatId={activeChatId}
          chatName={chat.name}
          state={state}
          chapters={chapters}
          generating={generation.generating}
          streamText={generation.streamText}
          phase={generation.phase}
          regeneratingMessageId={generation.regeneratingMessageId}
          onWrite={runWrite}
          onRetry={() => runWrite(lastWrite.current)}
          onStop={generation.stop}
          ledger={ledger}
          voices={voices}
          onSaveVoices={saveVoices}
          editor={editor}
        />
      )}
    </div>
  );
}
