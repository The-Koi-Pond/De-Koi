import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  QUICK_REPLY_ICON_IDS,
  useUIStore,
  type QuickReplyActionScope,
  type QuickReplyIconId,
  type QuickReplyModeScope,
  type UserQuickReplyActionConfig,
} from "../../../../../shared/stores/ui.store";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { UserQuickReplyIcon } from "../../../../../shared/components/ui/UserQuickReplyIcon";
import { cn } from "../../../../../shared/lib/utils";

const ICON_LABELS: Record<QuickReplyIconId, string> = {
  "file-text": "Post",
  wand: "Magic",
  "user-check": "Persona",
  "message-circle": "Chat",
  "scroll-text": "Script",
  bookmark: "Saved",
  zap: "Action",
  dices: "Dice",
};

const MODE_LABELS: Record<QuickReplyModeScope, string> = {
  conversation: "Conversation",
  roleplay: "Roleplay",
  game: "Game",
};

type ActionTextDraft = Partial<Pick<UserQuickReplyActionConfig, "label" | "commandTemplate">>;

function newQuickReplyAction(activeChatId: string | null, mode: QuickReplyModeScope): UserQuickReplyActionConfig {
  return {
    id: `quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: "New action",
    iconId: "wand",
    commandTemplate: "/guided {{draft}}",
    includeDraft: true,
    scope: activeChatId ? "chat" : "mode",
    mode,
    ...(activeChatId ? { chatId: activeChatId } : {}),
    enabled: true,
  };
}

function getCurrentMode(rawMode: unknown): QuickReplyModeScope {
  if (rawMode === "roleplay") return "roleplay";
  if (rawMode === "game") return "game";
  return "conversation";
}

function actionScopeLabel(action: UserQuickReplyActionConfig) {
  if (action.scope === "global") return "Global";
  if (action.scope === "mode") return action.mode ? MODE_LABELS[action.mode] : "Mode";
  return "Current chat";
}

export function UserQuickRepliesManager() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const activeChatMode = useChatStore((s) => s.activeChat?.mode);
  const currentMode = getCurrentMode(activeChatMode);
  const actions = useUIStore((s) => s.userQuickReplyActions);
  const setActions = useUIStore((s) => s.setUserQuickReplyActions);
  const [expandedId, setExpandedId] = useState<string | null>(actions[0]?.id ?? null);
  const [textDrafts, setTextDrafts] = useState<Record<string, ActionTextDraft>>({});
  const orderedActions = useMemo(
    () => actions.map((action) => ({ ...action, ...textDrafts[action.id] })),
    [actions, textDrafts],
  );

  useEffect(() => {
    const actionIds = new Set(actions.map((action) => action.id));
    setTextDrafts((drafts) =>
      Object.fromEntries(Object.entries(drafts).filter(([actionId]) => actionIds.has(actionId))),
    );
  }, [actions]);

  const updateAction = (id: string, patch: Partial<UserQuickReplyActionConfig>) => {
    setActions(actions.map((action) => (action.id === id ? { ...action, ...patch } : action)));
  };

  const updateActionText = (
    action: UserQuickReplyActionConfig,
    field: keyof ActionTextDraft,
    value: string,
  ) => {
    const nextLabel = field === "label" ? value : action.label;
    const nextCommandTemplate = field === "commandTemplate" ? value : action.commandTemplate;

    setTextDrafts((drafts) => ({
      ...drafts,
      [action.id]: {
        ...drafts[action.id],
        [field]: value,
      },
    }));

    if (nextLabel.trim() && nextCommandTemplate.trim()) {
      updateAction(action.id, {
        label: nextLabel,
        commandTemplate: nextCommandTemplate,
      });
    }
  };

  const changeScope = (action: UserQuickReplyActionConfig, scope: QuickReplyActionScope) => {
    if (scope === "global") {
      updateAction(action.id, { scope, mode: undefined, chatId: undefined });
      return;
    }
    if (scope === "mode") {
      updateAction(action.id, { scope, mode: action.mode ?? currentMode, chatId: undefined });
      return;
    }
    if (!activeChatId) return;
    updateAction(action.id, { scope, mode: undefined, chatId: activeChatId });
  };

  const moveAction = (id: string, direction: -1 | 1) => {
    const index = actions.findIndex((action) => action.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= actions.length) return;
    const next = [...actions];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setActions(next);
  };

  const addAction = () => {
    const next = newQuickReplyAction(activeChatId, currentMode);
    setActions([...actions, next]);
    setExpandedId(next.id);
  };

  const deleteAction = (id: string) => {
    setActions(actions.filter((action) => action.id !== id));
    setTextDrafts((drafts) => {
      const next = { ...drafts };
      delete next[id];
      return next;
    });
    if (expandedId === id) setExpandedId(null);
  };

  return (
    <div className="grid gap-1.5 border-t border-[var(--border)]/60 bg-[var(--background)]/20 p-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2 px-0.5">
        <span className="text-[0.6875rem] font-semibold text-[var(--foreground)]">Custom actions</span>
        <button
          type="button"
          onClick={addAction}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--primary)]/12 px-2 text-[0.6875rem] font-medium text-[var(--primary)] ring-1 ring-[var(--primary)]/25 transition-all hover:bg-[var(--primary)]/18 active:scale-[0.98]"
        >
          <Plus size="0.75rem" />
          Add
        </button>
      </div>

      {orderedActions.length === 0 ? (
        <div className="rounded-md bg-[var(--secondary)]/35 px-2.5 py-2 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]/60">
          No custom actions yet
        </div>
      ) : (
        orderedActions.map((action, index) => {
          const expanded = expandedId === action.id;
          return (
            <div
              key={action.id}
              className="overflow-hidden rounded-md bg-[var(--secondary)]/28 ring-1 ring-[var(--border)]/60"
            >
              <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1.5">
                <button
                  type="button"
                  onClick={() => updateAction(action.id, { enabled: !action.enabled })}
                  aria-pressed={action.enabled}
                  title={action.enabled ? "Disable action" : "Enable action"}
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 transition-colors",
                    action.enabled
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] ring-[var(--primary)]"
                      : "bg-[var(--background)]/45 text-transparent ring-[var(--border)] hover:text-[var(--muted-foreground)]",
                  )}
                >
                  <Check size="0.6875rem" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : action.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-[var(--background)]/40"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--background)]/50 text-[var(--foreground)] ring-1 ring-[var(--border)]/60">
                    <UserQuickReplyIcon iconId={action.iconId} size="0.8125rem" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.75rem] font-semibold text-[var(--foreground)]">
                      {action.label}
                    </span>
                    <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                      {actionScopeLabel(action)} · {action.commandTemplate}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => moveAction(action.id, -1)}
                  disabled={index === 0}
                  title="Move up"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-30"
                >
                  <ArrowUp size="0.6875rem" />
                </button>
                <button
                  type="button"
                  onClick={() => moveAction(action.id, 1)}
                  disabled={index === orderedActions.length - 1}
                  title="Move down"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-30"
                >
                  <ArrowDown size="0.6875rem" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteAction(action.id)}
                  title="Delete action"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                >
                  <Trash2 size="0.6875rem" />
                </button>
              </div>

              {expanded && (
                <div className="grid gap-2 border-t border-[var(--border)]/60 p-2">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <label className="grid gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                      Label
                      <input
                        value={action.label}
                        maxLength={24}
                        onChange={(event) => updateActionText(action, "label", event.target.value)}
                        className="min-w-0 rounded-md bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]"
                      />
                    </label>
                    <label className="grid gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                      Scope
                      <select
                        value={action.scope}
                        onChange={(event) => changeScope(action, event.target.value as QuickReplyActionScope)}
                        className="rounded-md bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]"
                      >
                        <option value="global">Global</option>
                        <option value="mode">Mode</option>
                        <option value="chat" disabled={!activeChatId}>
                          Current chat
                        </option>
                      </select>
                    </label>
                  </div>

                  <label className="grid gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                    Slash command
                    <input
                      value={action.commandTemplate}
                      maxLength={500}
                      onChange={(event) => updateActionText(action, "commandTemplate", event.target.value)}
                      placeholder="/guided {{draft}}"
                      className="min-w-0 rounded-md bg-[var(--background)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]"
                    />
                  </label>

                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    {action.scope === "mode" ? (
                      <label className="grid gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        Mode
                        <select
                          value={action.mode ?? currentMode}
                          onChange={(event) =>
                            updateAction(action.id, { mode: event.target.value as QuickReplyModeScope })
                          }
                          className="rounded-md bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]"
                        >
                          <option value="conversation">Conversation</option>
                          <option value="roleplay">Roleplay</option>
                          <option value="game">Game</option>
                        </select>
                      </label>
                    ) : (
                      <div />
                    )}
                    <label className="flex min-h-8 items-center gap-2 rounded-md bg-[var(--background)]/45 px-2 text-xs ring-1 ring-[var(--border)]">
                      <input
                        type="checkbox"
                        checked={action.includeDraft}
                        onChange={(event) => updateAction(action.id, { includeDraft: event.target.checked })}
                        className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
                      />
                      Use draft
                    </label>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                    {QUICK_REPLY_ICON_IDS.map((iconId) => (
                      <button
                        type="button"
                        key={iconId}
                        onClick={() => updateAction(action.id, { iconId })}
                        aria-label={`Use ${ICON_LABELS[iconId]} icon`}
                        title={ICON_LABELS[iconId]}
                        className={cn(
                          "flex h-8 items-center justify-center rounded-md ring-1 transition-colors",
                          action.iconId === iconId
                            ? "bg-[var(--primary)]/12 text-[var(--primary)] ring-[var(--primary)]/35"
                            : "bg-[var(--background)]/45 text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]",
                        )}
                      >
                        <UserQuickReplyIcon iconId={iconId} size="0.8125rem" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
