import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { ChevronDown, GripVertical, Pencil, Plus, Regex, ToggleLeft, ToggleRight, Trash2, Upload } from "lucide-react";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { cn } from "../../../../shared/lib/utils";
import { regexScriptTargetCharacterIds } from "../lib/regex-script-filter";
import { parseRegexScriptImportPayloads } from "../lib/regex-script-import";
import {
  useCreateRegexScript,
  useDeleteRegexScript,
  useRegexScripts,
  useReorderRegexScripts,
  useUpdateRegexScript,
  type RegexScriptRow,
} from "../hooks/use-regex-scripts";

type RegexScriptsSectionProps = {
  title?: string;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
};

export function RegexScriptsSection({
  title = "Regex Scripts",
  description = "Find/replace patterns applied to AI output or user input - like SillyTavern regex scripts.",
  defaultOpen = true,
  className,
}: RegexScriptsSectionProps) {
  const { data: regexScripts } = useRegexScripts();
  const createRegexScript = useCreateRegexScript();
  const updateRegex = useUpdateRegexScript();
  const deleteRegex = useDeleteRegexScript();
  const reorderRegexScripts = useReorderRegexScripts();
  const openRegexDetail = useUIStore((s) => s.openRegexDetail);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [draggedRegexId, setDraggedRegexId] = useState<string | null>(null);
  const [regexDragReadyId, setRegexDragReadyId] = useState<string | null>(null);

  const sortedRegexScripts = useMemo(
    () => [...((regexScripts ?? []) as RegexScriptRow[])].sort((a, b) => a.order - b.order),
    [regexScripts],
  );

  const handleCreateRegex = () => {
    openRegexDetail("__new__");
  };

  const handleImportRegex = async (event: ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payloads = parseRegexScriptImportPayloads(parsed);
      for (const payload of payloads) {
        await createRegexScript.mutateAsync(payload);
      }
      setImportSuccess(`Imported ${payloads.length} regex script(s).`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import regex scripts");
    }
    event.target.value = "";
  };

  const handleRegexDrop = (targetId: string) => {
    if (!draggedRegexId || draggedRegexId === targetId) return;
    const nextIds = sortedRegexScripts.map((script) => script.id);
    const from = nextIds.indexOf(draggedRegexId);
    const to = nextIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = nextIds.splice(from, 1);
    if (!moved) return;
    nextIds.splice(to, 0, moved);
    reorderRegexScripts.mutate(nextIds);
    setDraggedRegexId(null);
    setRegexDragReadyId(null);
  };

  return (
    <PanelSection
      title={title}
      icon={<Regex size="0.8125rem" />}
      defaultOpen={defaultOpen}
      className={className}
      action={
        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateRegex}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
            title="Create regex script"
          >
            <Plus size="0.8125rem" />
          </button>
          <label
            className="inline-flex cursor-pointer items-center justify-center rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)]"
            title="Import regex scripts from JSON"
          >
            <input type="file" accept="application/json" className="hidden" onChange={handleImportRegex} />
            <Upload size="0.8125rem" />
          </label>
        </div>
      }
    >
      <div className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">{description}</div>
      {importError && <div className="mb-1 text-xs text-red-500">{importError}</div>}
      {importSuccess && <div className="mb-1 text-xs text-green-500">{importSuccess}</div>}
      {sortedRegexScripts.length === 0 ? (
        <p className="px-1 py-2 text-[0.625rem] text-[var(--muted-foreground)]">No regex scripts yet.</p>
      ) : (
        sortedRegexScripts.map((script) => {
          const placements = Array.isArray(script.placement) ? script.placement : [];
          const targetCharacterIds = regexScriptTargetCharacterIds(script);
          const enabled = script.enabled === true || script.enabled === "true" || script.enabled === "1";
          return (
            <div
              key={script.id}
              className={cn(
                "flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-[var(--sidebar-accent)]",
                !enabled && "opacity-50",
                draggedRegexId === script.id && "opacity-40",
              )}
              draggable={regexDragReadyId === script.id}
              onDragStart={(event) => {
                setDraggedRegexId(script.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", script.id);
              }}
              onDragOver={(event) => {
                if (draggedRegexId && draggedRegexId !== script.id) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleRegexDrop(script.id);
              }}
              onDragEnd={() => {
                setDraggedRegexId(null);
                setRegexDragReadyId(null);
              }}
            >
              <button
                className="mt-0.5 shrink-0 cursor-grab rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] active:cursor-grabbing"
                title="Drag to reorder"
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  setRegexDragReadyId(script.id);
                }}
                onMouseUp={(event) => {
                  event.stopPropagation();
                  setRegexDragReadyId(null);
                }}
              >
                <GripVertical size="0.8125rem" />
              </button>
              <Regex size="0.875rem" className="mt-0.5 shrink-0 text-orange-400" />
              <button className="min-w-0 flex-1 text-left" onClick={() => openRegexDetail(script.id)}>
                <div className="text-xs font-medium">{script.name}</div>
                <div className="mt-0.5 flex items-center gap-1">
                  {placements.map((placement: string) => (
                    <span
                      key={placement}
                      className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]"
                    >
                      {placement === "ai_output" ? "AI" : "User"}
                    </span>
                  ))}
                  <span className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                    {targetCharacterIds.length === 0
                      ? "Global"
                      : targetCharacterIds.length === 1
                        ? "1 char"
                        : `${targetCharacterIds.length} chars`}
                  </span>
                  <span className="max-w-[6.25rem] truncate font-mono text-[0.5625rem] text-[var(--muted-foreground)]">
                    /{script.findRegex}/{script.flags}
                  </span>
                </div>
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                title={enabled ? "Disable script" : "Enable script"}
                onClick={(event) => {
                  event.stopPropagation();
                  updateRegex.mutate({ id: script.id, enabled: !enabled });
                }}
              >
                {enabled ? <ToggleRight size="0.875rem" className="text-amber-400" /> : <ToggleLeft size="0.875rem" />}
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
                title="Edit script"
                onClick={() => openRegexDetail(script.id)}
              >
                <Pencil size="0.8125rem" />
              </button>
              <button
                className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                title="Delete script"
                onClick={async () => {
                  if (
                    await showConfirmDialog({
                      title: "Delete Regex Script",
                      message: `Delete "${script.name}"?`,
                      confirmLabel: "Delete",
                      tone: "destructive",
                    })
                  ) {
                    deleteRegex.mutate(script.id);
                  }
                }}
              >
                <Trash2 size="0.8125rem" />
              </button>
            </div>
          );
        })
      )}
    </PanelSection>
  );
}

function PanelSection({
  title,
  icon,
  action,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("mb-1 border-b border-[var(--border)] pb-1 last:border-b-0", className)}>
      <div className="flex items-center gap-1.5 px-1 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1.5 text-left">
          <span className="text-[var(--muted-foreground)]">{icon}</span>
          <span className="text-[0.6875rem] font-semibold">{title}</span>
          <ChevronDown
            size="0.6875rem"
            className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
          />
        </button>
        {action}
      </div>
      {open && <div className="px-0.5">{children}</div>}
    </div>
  );
}
