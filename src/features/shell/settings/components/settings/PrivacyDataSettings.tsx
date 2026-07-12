import { useState } from "react";
import { AlertTriangle, Check, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useClearAllData, useExpungeData, type ExpungeScope } from "../../hooks/use-admin-data-reset";
import { canEraseAllDeKoiData, FULL_DATA_ERASE_PHRASE } from "../../lib/privacy-data-controls";

const SCOPE_OPTIONS: Array<{ id: ExpungeScope; label: string; description: string }> = [
  { id: "chats", label: "Chats & Messages", description: "Chats, messages, memories, and chat runtime state." },
  { id: "characters", label: "Characters", description: "Characters, versions, galleries, avatars, and sprites." },
  { id: "personas", label: "Personas", description: "Personas, galleries, avatars, and sprites." },
  { id: "lorebooks", label: "Lorebooks", description: "Lorebooks, entries, folders, and managed images." },
  { id: "presets", label: "Presets", description: "Prompt presets, groups, sections, and variables." },
  { id: "connections", label: "Connections", description: "Provider connections, endpoints, and stored credentials." },
  { id: "automation", label: "Automation & Themes", description: "Agents, tools, scripts, extensions, and themes." },
  { id: "media", label: "Media & Assets", description: "Gallery items, backgrounds, fonts, and knowledge files." },
];

export function PrivacyDataSettings() {
  const setSettingsTab = useUIStore((state) => state.setSettingsTab);
  const clearAllData = useClearAllData();
  const expungeData = useExpungeData();
  const [selectedScopes, setSelectedScopes] = useState<ExpungeScope[]>(["chats"]);
  const [confirmSelected, setConfirmSelected] = useState(false);
  const [showFullWipe, setShowFullWipe] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const isClearing = clearAllData.isPending || expungeData.isPending;
  const allSelected = selectedScopes.length === SCOPE_OPTIONS.length;

  const toggleScope = (scope: ExpungeScope) => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope],
    );
  };

  const clearSelected = () => {
    expungeData.mutate(selectedScopes, {
      onSuccess: () => toast.success("Selected De-Koi data was permanently erased."),
      onError: () => toast.error("De-Koi couldn't finish erasing the selected data. Some items may remain."),
      onSettled: () => setConfirmSelected(false),
    });
  };

  const eraseEverything = () => {
    if (!canEraseAllDeKoiData(confirmationPhrase)) return;
    clearAllData.mutate(undefined, {
      onSuccess: () => {
        toast.success("All De-Koi-managed data was permanently erased.");
        setConfirmationPhrase("");
        setShowFullWipe(false);
      },
      onError: () => toast.error("De-Koi couldn't finish the complete wipe. Some managed data may remain."),
    });
  };

  return (
    <div id="settings-destination-privacy-data" className="scroll-mt-4 flex flex-col gap-3 rounded-xl transition-shadow duration-700">
      <div className="flex items-start gap-2 rounded-xl bg-emerald-500/8 p-3 ring-1 ring-emerald-500/20">
        <ShieldCheck size="1rem" className="mt-0.5 shrink-0 text-emerald-500" />
        <div>
          <div className="text-xs font-semibold">Privacy at a glance</div>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
            De-Koi stores your library and conversations in its configured runtime. Generation sends the context needed
            for that request to the provider you choose. Optional integrations transmit data only when used, and
            Deki-senpai asks before reading chats or researching the web.
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-[var(--secondary)]/40 p-3 ring-1 ring-[var(--border)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold">Backups & exports</div>
            <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
              Download a copy or manage recovery backups before deleting data.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsTab("advanced")}
            className="shrink-0 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] hover:bg-[var(--accent)]"
          >
            Open backup tools
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--destructive)]">
          <Trash2 size="0.875rem" /> Erase selected data
        </div>
        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
          Choose categories to permanently remove. Routine category deletion needs only one confirmation.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {SCOPE_OPTIONS.map((scope) => {
            const checked = selectedScopes.includes(scope.id);
            return (
              <label
                key={scope.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 ring-1",
                  checked ? "bg-[var(--destructive)]/10 ring-[var(--destructive)]/25" : "ring-[var(--border)]",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isClearing}
                  onChange={() => toggleScope(scope.id)}
                  className="mt-0.5 accent-[var(--destructive)]"
                />
                <span>
                  <span className="block text-xs font-medium">{scope.label}</span>
                  <span className="block text-[0.625rem] text-[var(--muted-foreground)]">{scope.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isClearing}
            onClick={() => setSelectedScopes(allSelected ? [] : SCOPE_OPTIONS.map((scope) => scope.id))}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium"
          >
            {allSelected ? "Clear selection" : "Select all"}
          </button>
          <button
            type="button"
            disabled={selectedScopes.length === 0 || isClearing}
            onClick={() => setConfirmSelected(true)}
            className="flex-1 rounded-lg bg-[var(--destructive)]/85 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Clear selected data
          </button>
        </div>
        {confirmSelected && (
          <div className="mt-3 rounded-lg bg-[var(--destructive)]/12 p-2.5">
            <p className="text-[0.6875rem] font-medium text-[var(--destructive)]">
              Permanently erase {selectedScopes.length} selected data{" "}
              {selectedScopes.length === 1 ? "category" : "categories"}?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmSelected(false)}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isClearing}
                onClick={clearSelected}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)] px-3 py-2 text-xs font-medium text-white"
              >
                {isClearing ? <Loader2 size="0.75rem" className="animate-spin" /> : <Check size="0.75rem" />} Confirm
                delete
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-red-500/45 bg-red-500/8 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-red-500">
          <AlertTriangle size="0.875rem" /> Complete De-Koi wipe
        </div>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
          Removes conversations, Assistant history, library data, managed assets, backups, temporary exports,
          credentials, thumbnails, and browser state. Files previously downloaded outside De-Koi cannot be recalled.
        </p>
        {!showFullWipe ? (
          <button
            type="button"
            onClick={() => setShowFullWipe(true)}
            className="mt-3 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-500"
          >
            Begin complete wipe
          </button>
        ) : (
          <div className="mt-3 rounded-lg bg-red-500/10 p-2.5">
            <label className="block text-[0.6875rem] font-medium">
              Type <span className="font-mono text-red-500">{FULL_DATA_ERASE_PHRASE}</span> to continue
              <input
                type="text"
                value={confirmationPhrase}
                onChange={(event) => setConfirmationPhrase(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label="Complete wipe confirmation phrase"
                className="mt-2 w-full rounded-lg bg-[var(--background)] px-3 py-2 font-mono text-xs outline-none ring-1 ring-[var(--border)] focus:ring-red-500"
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowFullWipe(false);
                  setConfirmationPhrase("");
                }}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canEraseAllDeKoiData(confirmationPhrase) || isClearing}
                onClick={eraseEverything}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {clearAllData.isPending ? (
                  <Loader2 size="0.75rem" className="animate-spin" />
                ) : (
                  <Trash2 size="0.75rem" />
                )}{" "}
                Permanently erase everything
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
