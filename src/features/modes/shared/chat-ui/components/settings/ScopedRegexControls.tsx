import { useMemo } from "react";
import { cn } from "../../../../../../shared/lib/utils";
import type { RegexScriptRow } from "../../../../../catalog/agents/index";

export function ScopedRegexModeSelector({
  mode,
  onChange,
}: {
  mode: "disabled" | "exclusive" | "chat";
  onChange: (mode: "disabled" | "exclusive" | "chat") => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Scoped Mode</label>
      <div className="flex gap-1">
        {(["disabled", "exclusive", "chat"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[0.625rem] font-medium capitalize transition-all",
              mode === m
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
            )}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="text-[0.5625rem] text-[var(--muted-foreground)]">
        {mode === "disabled" && "Only global regex scripts run. Character-scoped scripts are ignored."}
        {mode === "chat" && "Global + all character-scoped scripts in this chat run together."}
        {mode === "exclusive" && "Only character-scoped scripts run. Global scripts are skipped."}
      </p>
    </div>
  );
}

export function ScopedRegexCharacterGroups({
  scripts,
  charInfoMap,
  onToggle,
}: {
  scripts: RegexScriptRow[];
  charInfoMap: Map<string, { name: string; comment?: string | null }>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, RegexScriptRow[]>();
    for (const s of scripts) {
      if (!s.characterId) continue;
      const arr = map.get(s.characterId) ?? [];
      arr.push(s);
      map.set(s.characterId, arr);
    }
    return map;
  }, [scripts]);

  if (grouped.size === 0) {
    return (
      <p className="mt-2 rounded-lg bg-[var(--secondary)]/50 px-3 py-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
        No character-scoped regex scripts are loaded for this chat.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {Array.from(grouped.entries()).map(([charId, charScripts]) => {
        const info = charInfoMap.get(charId);
        return (
          <ScopedRegexCharacterGroup
            key={charId}
            characterName={info?.name ?? "Unknown"}
            scripts={charScripts}
            onToggle={onToggle}
          />
        );
      })}
    </div>
  );
}

function ScopedRegexCharacterGroup({
  characterName,
  scripts,
  onToggle,
}: {
  characterName: string;
  scripts: RegexScriptRow[];
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--muted)] text-[0.5rem] font-bold">
          {characterName[0]}
        </div>
        <span className="text-[0.6875rem] font-medium">{characterName}</span>
        <span className="ml-auto text-[0.5625rem] text-[var(--muted-foreground)]">{scripts.length} scripts</span>
      </div>
      <div className="space-y-1">
        {scripts.map((s) => {
          const isEnabled = s.enabled === true || s.enabled === "true";
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id, !isEnabled)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-all",
                isEnabled ? "bg-[var(--primary)]/5" : "opacity-50",
              )}
            >
              <div
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  isEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/40",
                )}
              />
              <span className="truncate text-[0.625rem]">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CardCssModeSelector({ mode, onChange }: { mode: string; onChange: (mode: string) => void }) {
  const options = [
    { id: "disabled", label: "Disabled", tooltip: "No card CSS is applied" },
    { id: "exclusive", label: "Exclusive", tooltip: "Each character's CSS only affects their own messages" },
    { id: "chat", label: "Chat", tooltip: "All card CSS affects the entire chat area" },
  ];
  return (
    <div className="space-y-1.5 rounded-lg bg-[var(--background)]/75 px-3 py-2 ring-1 ring-[var(--border)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6875rem] font-medium text-[var(--foreground)]">CSS Mode</span>
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-md ring-1 ring-[var(--border)]">
        {options.map((option, index) => {
          const active = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "min-w-0 px-2.5 py-1.5 text-[0.625rem] font-medium transition-colors",
                index > 0 && "border-l border-[var(--border)]",
                active
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              )}
              title={option.tooltip}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
