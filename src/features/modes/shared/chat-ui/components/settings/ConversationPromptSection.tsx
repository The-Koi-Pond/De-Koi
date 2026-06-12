import { Feather, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { DEFAULT_CONVERSATION_SYSTEM_PROMPT } from "../../../../../../engine/contracts/constants/conversation-prompt";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import { ExpandedTextarea } from "../../../../../../shared/components/ui/ExpandedTextarea";
import { useUIStore } from "../../../../../../shared/stores/ui.store";
import { useUpdateChatMetadata } from "../../../../../catalog/chats/index";
import { ChatSettingsSection as Section } from "./ChatSettingsSections";

export function ConversationPromptSection({
  chat,
  metadata,
  updateMeta,
}: {
  chat: Chat;
  metadata: Record<string, unknown>;
  updateMeta: ReturnType<typeof useUpdateChatMetadata>;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const customPrompt = typeof metadata.customSystemPrompt === "string" ? metadata.customSystemPrompt : "";
  const storedPrompt = customPrompt.trim();
  const usesDefaultPrompt = storedPrompt.length === 0 || storedPrompt === DEFAULT_CONVERSATION_SYSTEM_PROMPT;

  const openPromptEditor = () => {
    setPromptDraft(usesDefaultPrompt ? DEFAULT_CONVERSATION_SYSTEM_PROMPT : customPrompt);
    setPromptOpen(true);
  };

  const closePromptEditor = () => {
    const trimmedDraft = promptDraft.trim();
    const nextPrompt =
      trimmedDraft.length === 0 || trimmedDraft === DEFAULT_CONVERSATION_SYSTEM_PROMPT ? null : promptDraft;
    updateMeta.mutate({ id: chat.id, customSystemPrompt: nextPrompt });
    useUIStore.getState().setCustomConversationPrompt(nextPrompt);
    setPromptOpen(false);
  };

  const resetPrompt = () => {
    updateMeta.mutate({ id: chat.id, customSystemPrompt: null });
    useUIStore.getState().setCustomConversationPrompt(null);
  };

  return (
    <>
      <Section
        label="Prompt"
        icon={<Feather size="0.875rem" />}
        help="Conversation-only system prompt that shapes how characters text in this chat."
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 ring-1 ring-[var(--border)]">
            <div className="min-w-0">
              <span className="block text-[0.6875rem] font-medium text-[var(--foreground)]">System Prompt</span>
              <span className="block text-[0.625rem] text-[var(--muted-foreground)]">
                {usesDefaultPrompt ? "Using default conversation prompt" : "Using custom conversation prompt"}
              </span>
            </div>
            <span className="shrink-0 rounded-full bg-[var(--background)] px-2 py-0.5 text-[0.5625rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
              {usesDefaultPrompt ? "Default" : "Custom"}
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={openPromptEditor}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.625rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
            >
              <Pencil size="0.625rem" />
              Edit Prompt
            </button>
            {!usesDefaultPrompt && (
              <button
                onClick={resetPrompt}
                className="flex items-center justify-center rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                title="Reset to default prompt"
              >
                <Trash2 size="0.625rem" />
              </button>
            )}
          </div>
        </div>
      </Section>
      <ExpandedTextarea
        open={promptOpen}
        onClose={closePromptEditor}
        title="Edit System Prompt"
        value={promptDraft}
        onChange={setPromptDraft}
        placeholder="Enter your custom system prompt..."
      />
    </>
  );
}

// ── Impersonate settings content (rendered inside an Impersonate Section) ──
