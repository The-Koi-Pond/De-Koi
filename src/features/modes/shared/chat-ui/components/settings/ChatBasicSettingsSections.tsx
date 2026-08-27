import { AlertTriangle, Check, Eye, LetterText, Pencil, Plug, Sliders } from "lucide-react";

import type { Chat } from "../../../../../../engine/contracts/types/chat";
import type { ChatPreset } from "../../../../../../engine/contracts/types/chat-preset";
import { ChatSettingsSection as Section } from "./ChatSettingsSections";

type TextConnection = { id: string; name: string; model?: string; capabilities?: { vision?: boolean } };

export function ChatBasicSettingsSections({
  chat,
  isConversation,
  isGame,
  sceneSystemPrompt,
  editingName,
  nameVal,
  textConnectionsList,
  visionConnectionId,
  presets,
  currentPromptPresetHasVariables,
  showLorebookMarkerWarning,
  onNameValChange,
  onEditName,
  onSaveName,
  onConnectionChange,
  onVisionConnectionChange,
  onPresetChange,
  onEditPresetChoices,
}: {
  chat: Chat;
  isConversation: boolean;
  isGame: boolean;
  sceneSystemPrompt: string;
  editingName: boolean;
  nameVal: string;
  textConnectionsList: TextConnection[];
  visionConnectionId: string | null;
  presets: ChatPreset[] | undefined;
  currentPromptPresetHasVariables: boolean;
  showLorebookMarkerWarning: boolean;
  onNameValChange: (value: string) => void;
  onEditName: () => void;
  onSaveName: () => void;
  onConnectionChange: (connectionId: string | null) => void;
  onVisionConnectionChange: (connectionId: string | null) => void;
  onPresetChange: (presetId: string | null) => void;
  onEditPresetChoices: () => void;
}) {
  return (
    <>
      <Section
        label="Chat Name"
        icon={<LetterText size="0.875rem" />}
        help="This name is only visible to you — it won't be sent to the AI or affect the conversation in any way."
      >
        {editingName ? (
          <div className="flex gap-2">
            <input
              value={nameVal}
              onChange={(event) => onNameValChange(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && onSaveName()}
              autoFocus
              className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--primary)]/40"
            />
            <button onClick={onSaveName} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs text-white">
              <Check size="0.75rem" />
            </button>
          </div>
        ) : (
          <button
            onClick={onEditName}
            className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
          >
            {chat.name}
          </button>
        )}
      </Section>

      <Section
        label="Vision / Image Input Connection"
        icon={<Eye size="0.875rem" />}
        help="Optional language model used when your message includes an image. Without an override, De-Koi uses the normal chat connection."
      >
        <ConnectionSelect
          value={visionConnectionId ?? ""}
          connections={textConnectionsList}
          includeModel
          includeRandom={false}
          emptyLabel="Use chat connection"
          showVisionCapability
          onChange={onVisionConnectionChange}
        />
        <p className="mt-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
          Connections marked vision-capable are identified below. Confirm model support with your provider before relying on image input.
        </p>
      </Section>

      <Section
        label="Connection"
        icon={<Plug size="0.875rem" />}
        help={
          isGame
            ? "Separate AI models for the Game Master (narration, world, NPCs) and the Party chat (inter-character banter)."
            : "Which AI provider and model to use for this chat. 'Random' picks a different connection each time from your random pool."
        }
      >
        {isGame ? (
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                GM / Party Model
              </label>
              <ConnectionSelect
                value={chat.connectionId ?? ""}
                connections={textConnectionsList}
                includeModel
                onChange={onConnectionChange}
              />
            </div>
          </div>
        ) : (
          <>
            <ConnectionSelect
              value={chat.connectionId ?? ""}
              connections={textConnectionsList}
              onChange={onConnectionChange}
            />
            {chat.connectionId === "random" && (
              <p className="mt-1.5 text-[0.625rem] text-amber-400/80">
                Each generation will randomly pick from connections marked for the random pool.
              </p>
            )}
          </>
        )}
      </Section>

      {!isConversation && !isGame && !sceneSystemPrompt && (
        <Section
          label="Prompt Preset"
          icon={<Sliders size="0.875rem" />}
          help="Presets control how the system prompt is structured and what generation parameters are used. Different presets produce different AI behaviors."
        >
          <div className="flex items-center gap-1.5">
            <select
              value={chat.promptPresetId ?? ""}
              onChange={(event) => onPresetChange(event.target.value || null)}
              className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            >
              <option value="">None</option>
              {(presets ?? []).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            {chat.promptPresetId && currentPromptPresetHasVariables && (
              <button
                onClick={onEditPresetChoices}
                className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                title="Edit preset variables"
              >
                <Pencil size="0.8125rem" />
              </button>
            )}
          </div>
          {showLorebookMarkerWarning && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[0.6875rem] text-amber-200 ring-1 ring-amber-400/25">
              <AlertTriangle size="0.75rem" className="mt-[0.125rem] shrink-0" />
              <span>This preset has active lorebooks available, but no lorebook marker.</span>
            </div>
          )}
        </Section>
      )}
    </>
  );
}

function ConnectionSelect({
  value,
  connections,
  includeModel = false,
  includeRandom = true,
  emptyLabel = "None",
  showVisionCapability = false,
  onChange,
}: {
  value: string;
  connections: TextConnection[];
  includeModel?: boolean;
  includeRandom?: boolean;
  emptyLabel?: string;
  showVisionCapability?: boolean;
  onChange: (connectionId: string | null) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value || null)}
      className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
    >
      <option value="">{emptyLabel}</option>
      {includeRandom && <option value="random">🎲 Random</option>}
      {connections.map((connection) => (
        <option key={connection.id} value={connection.id}>
          {connection.name}
          {includeModel && connection.model ? ` — ${connection.model}` : ""}
          {showVisionCapability && connection.capabilities?.vision === true ? " (vision-capable)" : ""}
        </option>
      ))}
    </select>
  );
}
