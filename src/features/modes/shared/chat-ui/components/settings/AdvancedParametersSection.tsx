import { Save, Settings2 } from "lucide-react";
import { useState } from "react";
import {
  CHAT_PARAMETER_DEFAULTS,
  EDITABLE_GENERATION_PARAMETER_KEYS,
  GenerationParametersFields,
  getEditableGenerationParameters,
  getEditableGenerationParameterOverrides,
  parseGenerationParameterRecord,
  ROLEPLAY_PARAMETER_DEFAULTS,
  serviceTierOptionsForProvider,
  type EditableGenerationParameters,
} from "../../../../../../shared/components/ui/GenerationParametersEditor";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import {
  isSyntheticConnection,
  useSaveConnectionDefaults,
  type ConnectionSummary,
} from "../../../../../catalog/connections/index";
import { useUpdateChatMetadata } from "../../../../../catalog/chats/index";
import { ChatSettingsSectionHeader } from "./ChatSettingsSections";

const EDITABLE_GENERATION_PARAMETER_KEY_SET = new Set<string>(EDITABLE_GENERATION_PARAMETER_KEYS);

function storedConnectionForDefaults(
  connectionId: string | null,
  connections: ConnectionSummary[],
): ConnectionSummary | null {
  if (!connectionId) return null;
  const connection = connections.find((candidate) => candidate.id === connectionId) ?? null;
  return connection && !isSyntheticConnection(connection) ? connection : null;
}

function generationParameterRecord(value: unknown): Record<string, unknown> {
  return parseGenerationParameterRecord(value) ?? {};
}

function retainNonEditableGenerationParameters(value: unknown): Record<string, unknown> {
  const record = generationParameterRecord(value);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !EDITABLE_GENERATION_PARAMETER_KEY_SET.has(key)));
}

export function AdvancedParametersSection({
  chat,
  metadata,
  updateMeta,
  isConversation,
  connectionId,
  connections,
  promptPresetParameters,
  inheritedGenerationParametersPending,
}: {
  chat: Chat;
  metadata: Record<string, unknown>;
  updateMeta: ReturnType<typeof useUpdateChatMetadata>;
  isConversation: boolean;
  connectionId: string | null;
  connections: ConnectionSummary[];
  promptPresetParameters?: unknown;
  inheritedGenerationParametersPending?: boolean;
}) {
  const modeDefaults = isConversation ? CHAT_PARAMETER_DEFAULTS : ROLEPLAY_PARAMETER_DEFAULTS;
  // Use connection-saved defaults if available, otherwise fall back to mode defaults
  const conn = connectionId ? (connections.find((c) => c.id === connectionId) ?? null) : null;
  const storedConnection = storedConnectionForDefaults(connectionId, connections);
  const connectionDefaults = getEditableGenerationParameters(modeDefaults, conn?.defaultParameters);
  const defaults = getEditableGenerationParameters(connectionDefaults, isConversation ? null : promptPresetParameters);
  const saveDefaults = useSaveConnectionDefaults();
  const [expanded, setExpanded] = useState(false);
  const params = generationParameterRecord(metadata.chatParameters);
  const retainedNonEditableParams = retainNonEditableGenerationParameters(params);
  const effectiveParams = getEditableGenerationParameters(defaults, params);
  const currentEditableOverrides = getEditableGenerationParameterOverrides(defaults, effectiveParams);
  // Save connection defaults from connection-scoped values only; prompt presets are chat/runtime inheritance.
  const connectionScopedParams = getEditableGenerationParameters(connectionDefaults, currentEditableOverrides);

  const setParameters = (next: EditableGenerationParameters) => {
    const editableOverrides = getEditableGenerationParameterOverrides(defaults, next) ?? {};
    const nextParams = { ...retainedNonEditableParams, ...editableOverrides };
    updateMeta.mutate({
      id: chat.id,
      chatParameters: Object.keys(nextParams).length > 0 ? nextParams : null,
    });
  };

  return (
    <div className="border-b border-[var(--border)]">
      <ChatSettingsSectionHeader
        label="Advanced Parameters"
        icon={<Settings2 size="0.875rem" />}
        help="Override generation parameters for this chat. Only change these if you know what you're doing."
        expanded={expanded}
        onToggle={() => setExpanded((o) => !o)}
      />
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {inheritedGenerationParametersPending ? (
            <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
              Loading inherited generation parameters...
            </div>
          ) : (
            <>
              <GenerationParametersFields
                value={effectiveParams}
                onChange={setParameters}
                serviceTierOptions={serviceTierOptionsForProvider(conn?.provider)}
              />
              {/* Save as Default for Connection */}
              {storedConnection && (
                <button
                  onClick={() => {
                    saveDefaults.mutate({
                      id: storedConnection.id,
                      params: connectionScopedParams as unknown as Record<string, unknown>,
                    });
                  }}
                  className="w-full rounded-lg bg-[var(--primary)]/10 px-3 py-1.5 text-[0.625rem] font-medium text-[var(--primary)] ring-1 ring-[var(--primary)]/20 transition-colors hover:bg-[var(--primary)]/20"
                >
                  <Save size="0.625rem" className="inline mr-1 -mt-px" />
                  {saveDefaults.isPending ? "Saving..." : "Save as Connection Default"}
                </button>
              )}
              {/* Reset */}
              <button
                onClick={() => {
                  updateMeta.mutate({
                    id: chat.id,
                    chatParameters:
                      Object.keys(retainedNonEditableParams).length > 0 ? retainedNonEditableParams : null,
                  });
                }}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                Reset to Inherited Defaults
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
