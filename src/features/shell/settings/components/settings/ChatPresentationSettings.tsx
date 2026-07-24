import { MessageCircle } from "lucide-react";
import {
  CONVERSATION_MESSAGE_STYLE_OPTIONS,
  useUIStore,
  type ConversationMessageStyle,
} from "../../../../../shared/stores/ui.store";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { cn } from "../../../../../shared/lib/utils";
import { ToggleSetting } from "./SettingControls";

export function ChatPresentationSettings() {
  const messageGrouping = useUIStore((s) => s.messageGrouping);
  const setMessageGrouping = useUIStore((s) => s.setMessageGrouping);
  const conversationMessageStyle = useUIStore((s) => s.conversationMessageStyle);
  const setConversationMessageStyle = useUIStore((s) => s.setConversationMessageStyle);
  const showTimestamps = useUIStore((s) => s.showTimestamps);
  const setShowTimestamps = useUIStore((s) => s.setShowTimestamps);
  const showMemoryRecallIndicators = useUIStore((s) => s.showMemoryRecallIndicators);
  const setShowMemoryRecallIndicators = useUIStore((s) => s.setShowMemoryRecallIndicators);
  const showModelName = useUIStore((s) => s.showModelName);
  const setShowModelName = useUIStore((s) => s.setShowModelName);
  const showTokenUsage = useUIStore((s) => s.showTokenUsage);
  const setShowTokenUsage = useUIStore((s) => s.setShowTokenUsage);
  const showMessageNumbers = useUIStore((s) => s.showMessageNumbers);
  const setShowMessageNumbers = useUIStore((s) => s.setShowMessageNumbers);

  return (
    <section
      id="settings-destination-chat-presentation"
      className="scroll-mt-4 space-y-2 rounded-xl bg-[var(--secondary)]/35 p-3 ring-1 ring-[var(--border)] transition-shadow duration-700"
    >
      <div>
        <h3 className="text-xs font-semibold">Chat presentation</h3>
        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
          Choose how messages and their supporting details appear across chats.
        </p>
      </div>
      <ToggleSetting
        label="Group consecutive messages"
        checked={messageGrouping}
        onChange={setMessageGrouping}
        help="Combines multiple messages from the same sender into a visual group, reducing clutter in the chat."
      />
      <div className="flex flex-col gap-1.5 rounded-lg p-1">
        <div className="flex items-center gap-1.5">
          <MessageCircle size="0.75rem" className="text-[var(--muted-foreground)]" />
          <span className="text-xs">Chat layout</span>
          <HelpTooltip text="Choose whether Conversation mode renders messages as linear rows or Messenger-style bubbles." />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {CONVERSATION_MESSAGE_STYLE_OPTIONS.map((option) => {
            const selected = conversationMessageStyle === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setConversationMessageStyle(option.id as ConversationMessageStyle)}
                className={cn(
                  "flex min-h-14 flex-col items-start justify-center rounded-md border px-2.5 py-2 text-left",
                  selected
                    ? "border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--foreground)]"
                    : "border-[var(--border)] bg-[var(--background)]/35 text-[var(--muted-foreground)]",
                )}
              >
                <span className="text-[0.6875rem] font-semibold">{option.label}</span>
                <span className="text-[0.5625rem] leading-snug">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>
      <ToggleSetting
        label="Show message timestamps"
        checked={showTimestamps}
        onChange={setShowTimestamps}
        help="Displays the date and time each message was sent next to it in the chat."
      />
      <ToggleSetting
        label="Show recalled-memory indicators"
        checked={showMemoryRecallIndicators}
        onChange={setShowMemoryRecallIndicators}
        help="Shows the blue recalled-memory chip beside character names and timestamps. Hiding it does not disable memory recall."
      />
      <ToggleSetting
        label="Show model name on messages"
        checked={showModelName}
        onChange={setShowModelName}
        help="Displays which AI model generated each response."
      />
      <ToggleSetting
        label="Show token usage on messages"
        checked={showTokenUsage}
        onChange={setShowTokenUsage}
        help="Displays prompt and completion token counts on each AI message."
      />
      <ToggleSetting
        label="Show message numbers"
        checked={showMessageNumbers}
        onChange={setShowMessageNumbers}
        help="Displays message numbers in Roleplay and Conversation chats."
      />
    </section>
  );
}
