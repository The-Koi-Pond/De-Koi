import { useState } from "react";
import {
  CHAT_PARAMETER_DEFAULTS,
  GenerationParametersFields,
  getEditableGenerationParameters,
  parseEditableGenerationParameters,
  ROLEPLAY_PARAMETER_DEFAULTS,
  serviceTierOptionsForProvider,
  type EditableGenerationParameters,
} from "../../../../../../shared/components/ui/generation-parameters";
import type { ConnectionSummary } from "../../../../../catalog/connections/index";
import { SetupSwitch } from "./SetupSwitch";

export type SetupParameters = ReturnType<typeof useSetupParameters>;

/**
 * Custom generation parameters are the one pick setup holds back: they're saved as `chatParameters` when setup
 * finishes. The fields start from the chat's saved parameters over the connection's defaults, and start over when
 * the connection changes.
 */
export function useSetupParameters({
  metadata,
  isConversation,
  connection,
}: {
  metadata: Record<string, unknown>;
  isConversation: boolean;
  connection: ConnectionSummary | null;
}) {
  const [enabled, setEnabled] = useState(() => parseEditableGenerationParameters(metadata.chatParameters) !== null);
  const [edited, setEdited] = useState<{ connectionId: string; value: EditableGenerationParameters } | null>(null);

  const connectionId = connection?.id ?? "";
  const modeDefaults = isConversation ? CHAT_PARAMETER_DEFAULTS : ROLEPLAY_PARAMETER_DEFAULTS;
  const connectionDefaults = getEditableGenerationParameters(modeDefaults, connection?.defaultParameters);
  const value =
    edited?.connectionId === connectionId
      ? edited.value
      : getEditableGenerationParameters(connectionDefaults, metadata.chatParameters);

  return {
    enabled,
    setEnabled,
    value,
    setValue: (next: EditableGenerationParameters) => setEdited({ connectionId, value: next }),
    serviceTierOptions: serviceTierOptionsForProvider(connection?.provider),
    /** What finishing saves as `chatParameters`. */
    chatParameters: enabled ? value : null,
  };
}

export function SetupParametersPanel({ parameters }: { parameters: SetupParameters }) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] px-3 py-3">
      <SetupSwitch
        label="Customize parameters"
        description="Leave this off to use the connection's saved defaults."
        checked={parameters.enabled}
        onChange={parameters.setEnabled}
      />
      {parameters.enabled && (
        <GenerationParametersFields
          value={parameters.value}
          onChange={parameters.setValue}
          serviceTierOptions={parameters.serviceTierOptions}
        />
      )}
    </div>
  );
}
