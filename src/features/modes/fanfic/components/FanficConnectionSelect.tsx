import { useMemo } from "react";
import { toast } from "sonner";
import { useChat, useUpdateChat } from "../../../catalog/chats/index";
import { useConnections } from "../../../catalog/connections/index";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { FanficField, fanficInputClass } from "./fanfic-ui";

interface FanficConnectionOption {
  id: string;
  name?: string;
}

/**
 * The fic's model picker over language connections; with only one choice it just names it. `unlisted` is the fic's
 * current connection when it isn't one of them (deleted, or not a text model), shown as the chosen option.
 */
export function FanficConnectionSelect({
  id,
  connections,
  value,
  onChange,
  disabled = false,
  unlisted = null,
}: {
  id: string;
  connections: readonly FanficConnectionOption[];
  value: string | null;
  onChange: (connectionId: string | null) => void;
  disabled?: boolean;
  unlisted?: FanficConnectionOption | null;
}) {
  const choices = unlisted ? [unlisted, ...connections] : connections;
  if (choices.length === 0) return null;
  if (choices.length === 1) {
    const only = choices[0]!;
    return (
      <FanficField label="Model connection">
        <p className="truncate text-sm text-[var(--foreground)]">{only.name || only.id}</p>
      </FanficField>
    );
  }
  return (
    <FanficField label="Model connection" htmlFor={id}>
      <select
        id={id}
        className={fanficInputClass}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {unlisted ? (
          <option value={unlisted.id} disabled>
            {unlisted.name || unlisted.id}
          </option>
        ) : (
          !connections.some((connection) => connection.id === value) && <option value="">Choose a connection</option>
        )}
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.name || connection.id}
          </option>
        ))}
      </select>
    </FanficField>
  );
}

/** The reader's picker: saves only the chat's connection, so the request, outline and story stay as they are. */
export function FanficReaderConnectionSelect({ chatId, busy }: { chatId: string; busy: boolean }) {
  const { data: chat } = useChat(chatId);
  const { data: connections } = useConnections();
  const updateChat = useUpdateChat();
  const languageConnections = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; name?: string; provider?: string }>,
      ),
    [connections],
  );
  const current = chat?.connectionId ?? null;
  // The reader always names the fic's model, even one that was deleted or is no longer a text connection.
  const unlisted = useMemo(() => {
    if (!current || languageConnections.some((connection) => connection.id === current)) return null;
    const stored = (connections ?? []).find((connection) => connection.id === current) as
      | FanficConnectionOption
      | undefined;
    return { id: current, name: stored?.name };
  }, [connections, current, languageConnections]);

  const change = async (connectionId: string | null) => {
    if (!connectionId || connectionId === current) return;
    try {
      // A failed save rolls the cached chat back, so the picker shows the previous model again.
      await updateChat.mutateAsync({ id: chatId, connectionId });
    } catch (error) {
      toast.error(
        toUserMessage(error, { fallback: "Couldn't change the model. The fic still uses the previous one." }),
      );
    }
  };

  return (
    <FanficConnectionSelect
      id="fanfic-reader-connection"
      connections={languageConnections}
      value={current}
      unlisted={unlisted}
      onChange={(connectionId) => void change(connectionId)}
      disabled={busy || updateChat.isPending}
    />
  );
}
