import { useMemo, useState } from "react";
import { Check, ChevronDown, FileText, UserCheck, WandSparkles } from "lucide-react";
import { useConnections } from "../../../../catalog/connections";
import { usePresets } from "../../../../catalog/presets";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { filterLanguageGenerationConnections } from "../../../../../shared/lib/connection-filters";
import { cn } from "../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { ToggleSetting } from "./SettingControls";
import { UserQuickRepliesManager } from "./UserQuickRepliesManager";
import { ImpersonateSettingsContent } from "./ImpersonateSettingsContent";

export function ChatBehaviorSettings() {
  const showQuickRepliesMenu = useUIStore((s) => s.showQuickRepliesMenu);
  const setShowQuickRepliesMenu = useUIStore((s) => s.setShowQuickRepliesMenu);
  const showQuickReplyPostOnly = useUIStore((s) => s.showQuickReplyPostOnly);
  const setShowQuickReplyPostOnly = useUIStore((s) => s.setShowQuickReplyPostOnly);
  const showQuickReplyGuide = useUIStore((s) => s.showQuickReplyGuide);
  const setShowQuickReplyGuide = useUIStore((s) => s.setShowQuickReplyGuide);
  const showQuickReplyImpersonate = useUIStore((s) => s.showQuickReplyImpersonate);
  const setShowQuickReplyImpersonate = useUIStore((s) => s.setShowQuickReplyImpersonate);
  const guideGenerations = useUIStore((s) => s.guideGenerations);
  const setGuideGenerations = useUIStore((s) => s.setGuideGenerations);
  const scheduleGenerationPreferences = useUIStore((s) => s.scheduleGenerationPreferences);
  const setScheduleGenerationPreferences = useUIStore((s) => s.setScheduleGenerationPreferences);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(true);
  const { data: rawConnections } = useConnections();
  const { data: rawPresets } = usePresets();
  const connections = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (rawConnections ?? []) as Array<{ id: string; name: string; provider?: string }>,
      ),
    [rawConnections],
  );
  const presets = useMemo(
    () => (rawPresets ?? []).map((preset) => ({ id: preset.id, name: preset.name })),
    [rawPresets],
  );

  const handleQuickRepliesMenuChange = (enabled: boolean) => {
    setShowQuickRepliesMenu(enabled);
    if (enabled) setQuickRepliesOpen(true);
  };

  return (
    <section
      id="settings-destination-chat-behavior"
      className="scroll-mt-4 space-y-3 rounded-xl bg-[var(--secondary)]/35 p-3 ring-1 ring-[var(--border)] transition-shadow duration-700"
    >
      <div>
        <h3 className="text-xs font-semibold text-[var(--foreground)]">Chat behavior</h3>
        <p className="mt-1 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
          App-wide chat actions and generation behavior. These choices apply across chats.
        </p>
      </div>

      <div
        className={cn(
          "overflow-hidden rounded-xl border transition-colors",
          showQuickRepliesMenu
            ? "border-[var(--primary)]/30 bg-[var(--background)]/25"
            : "border-[var(--border)] bg-transparent",
        )}
      >
        <div className="flex min-h-9 items-stretch">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-2">
            <input
              type="checkbox"
              checked={showQuickRepliesMenu}
              onChange={(event) => handleQuickRepliesMenuChange(event.target.checked)}
              className="h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
            />
            <span className="text-xs">Quick replies</span>
            <HelpTooltip text="Adds alternate draft actions beside Send. One action appears directly; multiple actions open from the ellipsis." />
          </label>
          <button
            type="button"
            onClick={() => showQuickRepliesMenu && setQuickRepliesOpen((open) => !open)}
            disabled={!showQuickRepliesMenu}
            aria-controls="quick-replies-actions-drawer"
            aria-expanded={showQuickRepliesMenu && quickRepliesOpen}
            aria-label={quickRepliesOpen ? "Collapse Quick replies options" : "Expand Quick replies options"}
            className="flex min-w-10 items-center justify-center text-[var(--muted-foreground)] disabled:opacity-35"
          >
            <ChevronDown
              size="0.875rem"
              aria-hidden
              className={cn("transition-transform", (!showQuickRepliesMenu || !quickRepliesOpen) && "-rotate-90")}
            />
          </button>
        </div>
        {showQuickRepliesMenu && quickRepliesOpen && (
          <div
            id="quick-replies-actions-drawer"
            className="grid gap-1 border-t border-[var(--border)]/60 bg-[var(--background)]/25 p-1"
            role="group"
            aria-label="Quick replies actions to include"
          >
            {[
              {
                label: "Post only",
                checked: showQuickReplyPostOnly,
                onChange: setShowQuickReplyPostOnly,
                description: "Add persona message without triggering a reply.",
                icon: FileText,
              },
              {
                label: "Guide reply",
                checked: showQuickReplyGuide,
                onChange: setShowQuickReplyGuide,
                description: "Use draft as /guided direction.",
                icon: WandSparkles,
              },
              {
                label: "Impersonate",
                checked: showQuickReplyImpersonate,
                onChange: setShowQuickReplyImpersonate,
                description: "Generate a persona-side user reply.",
                icon: UserCheck,
              },
            ].map((option) => {
              const Icon = option.icon;
              return (
                <button
                  type="button"
                  key={option.label}
                  aria-pressed={option.checked}
                  onClick={() => option.onChange(!option.checked)}
                  className={cn(
                    "group flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ring-1 transition-all",
                    option.checked
                      ? "bg-[var(--primary)]/8 text-[var(--foreground)] ring-[var(--primary)]/30"
                      : "text-[var(--muted-foreground)] ring-transparent hover:bg-[var(--secondary)]/45",
                  )}
                >
                  <Icon size="0.8125rem" className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{option.label}</span>
                    <span className="block text-[0.65rem] leading-tight text-[var(--muted-foreground)]">
                      {option.description}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1",
                      option.checked
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] ring-[var(--primary)]"
                        : "text-transparent ring-[var(--border)]",
                    )}
                    aria-hidden
                  >
                    <Check size="0.625rem" strokeWidth={3} />
                  </span>
                </button>
              );
            })}
            <UserQuickRepliesManager />
          </div>
        )}
      </div>

      <ToggleSetting
        label="Guide swipes/regens with chat input"
        checked={guideGenerations}
        onChange={setGuideGenerations}
        help="Uses the current draft as direction when regenerating a message or manually triggering a character response."
      />

      <label className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          Schedule generation preferences
          <HelpTooltip text="Global guidance used whenever Conversation schedules are generated or regenerated." />
        </span>
        <textarea
          value={scheduleGenerationPreferences}
          onChange={(event) => setScheduleGenerationPreferences(event.target.value)}
          placeholder="e.g. Make everyone go to sleep before midnight. I work 9-5 on weekdays."
          className="min-h-20 resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs outline-none focus:border-[var(--primary)]/50"
        />
        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          Applies to every Conversation chat the next time schedules are generated.
        </p>
      </label>

      <div className="border-t border-[var(--border)] pt-3">
        <h4 className="mb-2 text-xs font-semibold">Impersonate</h4>
        <ImpersonateSettingsContent presets={presets} connections={connections} />
      </div>
    </section>
  );
}
