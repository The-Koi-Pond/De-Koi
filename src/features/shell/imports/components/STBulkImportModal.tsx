// ──────────────────────────────────────────────
// Modal: SillyTavern Bulk Import
// ──────────────────────────────────────────────
import { useState, type ReactNode } from "react";
import { Modal } from "../../../../shared/components/ui/Modal";
import {
  FolderSearch,
  FolderOpen,
  Loader2,
  CheckCircle,
  XCircle,
  Users,
  MessageSquare,
  FileText,
  BookOpen,
  Image,
  AlertTriangle,
  Import,
  UserCircle,
  ChevronRight,
  ArrowLeft,
  Folder,
  Check,
} from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { useSTBulkImportController } from "../hooks/use-st-bulk-import-controller";
import {
  formatSTBulkModifiedAt,
  ST_BULK_TAG_IMPORT_OPTIONS,
  type STBulkScanItemBase,
} from "../lib/st-bulk-import-model";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function STBulkImportModal({ open, onClose }: Props) {
  const controller = useSTBulkImportController();
  const {
    folderPath,
    phase,
    scanResult,
    selection,
    importResult,
    progress,
    error,
    characterTagImportMode,
    picking,
    showFolderBrowser,
    browserPath,
    browserFolders,
    browserLoading,
    builtinPresetCount,
    selectedCount,
    hasAnySelected,
    setFolderPath,
    setCharacterTagImportMode,
    reset,
    scan,
    browse,
    loadDirectory,
    selectBrowserFolder,
    updateCategorySelection,
    toggleCategoryItem,
    importSelected,
  } = controller;

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Import from SillyTavern" width="max-w-3xl">
      <div className="flex flex-col gap-4">
        {(phase === "input" || phase === "scanning") && (
          <>
            <p className="text-xs text-[var(--muted-foreground)]">
              Select or enter the path to your SillyTavern installation folder. We&apos;ll scan for characters, chats,
              presets, lorebooks, backgrounds, and personas before you choose exactly what to import.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">SillyTavern Folder Path</label>
              <div className="flex gap-2 max-sm:flex-col">
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/path/to/SillyTavern"
                  disabled={phase === "scanning"}
                  className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent placeholder:text-[var(--muted-foreground)]/50 focus:ring-[var(--primary)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") scan();
                  }}
                />
                <button
                  onClick={browse}
                  disabled={phase === "scanning" || picking}
                  className="flex items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--secondary)] active:scale-95 disabled:opacity-50"
                  title="Browse for folder"
                >
                  {picking ? <Loader2 size="0.875rem" className="animate-spin" /> : <FolderOpen size="0.875rem" />}
                  Browse
                </button>
              </div>
            </div>

            {showFolderBrowser && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                  <button
                    onClick={() => {
                      const parent = browserPath.includes("\\")
                        ? browserPath.replace(/\\[^\\]+$/, "")
                        : browserPath.replace(/\/[^/]+$/, "") || "/";
                      if (parent !== browserPath) loadDirectory(parent);
                    }}
                    disabled={browserLoading || browserPath === "/"}
                    className="rounded p-1 transition-colors hover:bg-[var(--accent)] disabled:opacity-30"
                    title="Go up"
                  >
                    <ArrowLeft size="0.75rem" />
                  </button>
                  <span className="flex-1 truncate font-mono text-[0.625rem] text-[var(--muted-foreground)]">
                    {browserPath || "/"}
                  </span>
                  <button
                    onClick={selectBrowserFolder}
                    className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[0.625rem] font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 active:scale-95"
                  >
                    Select This Folder
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {browserLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size="0.875rem" className="animate-spin text-[var(--muted-foreground)]" />
                    </div>
                  ) : browserFolders.length === 0 ? (
                    <p className="py-3 text-center text-[0.625rem] text-[var(--muted-foreground)]">No subfolders</p>
                  ) : (
                    browserFolders.map((name) => (
                      <button
                        key={name}
                        onClick={() => {
                          const sep = browserPath.includes("\\") ? "\\" : "/";
                          loadDirectory(browserPath ? `${browserPath}${sep}${name}` : name);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--accent)]"
                      >
                        <Folder size="0.8125rem" className="shrink-0 text-sky-400" />
                        <span className="truncate">{name}</span>
                        <ChevronRight size="0.6875rem" className="ml-auto shrink-0 text-[var(--muted-foreground)]" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            <button
              onClick={scan}
              disabled={!folderPath.trim() || phase === "scanning"}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-medium transition-all",
                folderPath.trim() && phase !== "scanning"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 active:scale-95"
                  : "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)] opacity-50",
              )}
            >
              {phase === "scanning" ? (
                <Loader2 size="0.875rem" className="animate-spin" />
              ) : (
                <FolderSearch size="0.875rem" />
              )}
              {phase === "scanning" ? "Scanning..." : "Scan Folder"}
            </button>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
                <XCircle size="0.875rem" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="rounded-lg bg-[var(--secondary)]/50 p-2.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
              <strong>Tip:</strong> This is the main SillyTavern folder, usually the one containing{" "}
              <code className="rounded bg-[var(--secondary)] px-1">data/</code> or{" "}
              <code className="rounded bg-[var(--secondary)] px-1">public/</code>.
            </div>
          </>
        )}

        {phase === "preview" && scanResult && (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-400">
              <CheckCircle size="0.875rem" className="mt-0.5 shrink-0" />
              <span>
                Found SillyTavern data in{" "}
                <code className="rounded bg-[var(--secondary)] px-1 text-[0.625rem]">{scanResult.dataDir}</code>
              </span>
            </div>

            {builtinPresetCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-400">
                <AlertTriangle size="0.875rem" className="mt-0.5 shrink-0" />
                <span>
                  {builtinPresetCount} built-in preset{builtinPresetCount !== 1 ? "s were" : " was"} detected and left
                  unchecked by default so only likely custom presets come across unless you opt in.
                </span>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Choose exactly what to import</span>
                <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{selectedCount} selected</span>
              </div>

              <SelectableImportCategory
                icon={<Users size="0.875rem" />}
                label="Characters"
                items={scanResult.characters}
                selectedIds={selection.characters}
                onToggleItem={(itemId, checked) => toggleCategoryItem("characters", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "characters",
                    scanResult.characters.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("characters", [])}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  return (
                    <span>
                      {item.format.toUpperCase()}
                      {modified ? ` · modified ${modified}` : ""}
                    </span>
                  );
                }}
              />

              {scanResult.characters.length > 0 && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-3">
                  <p className="text-xs font-medium text-[var(--foreground)]">Imported character tags</p>
                  <p className="mt-0.5 text-[0.6875rem] text-[var(--muted-foreground)]">
                    Choose how source-site tags are applied to imported characters.
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {ST_BULK_TAG_IMPORT_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
                          characterTagImportMode === option.value
                            ? "border-[var(--primary)] bg-[var(--primary)]/10"
                            : "border-[var(--border)] bg-[var(--background)]/40 hover:border-[var(--muted-foreground)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="bulkCharacterTagImportMode"
                          value={option.value}
                          checked={characterTagImportMode === option.value}
                          onChange={() => setCharacterTagImportMode(option.value)}
                          className="sr-only"
                        />
                        <span className="block text-xs font-medium text-[var(--foreground)]">{option.label}</span>
                        <span className="mt-1 block text-[0.625rem] leading-snug text-[var(--muted-foreground)]">
                          {option.description}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <SelectableImportCategory
                icon={<MessageSquare size="0.875rem" />}
                label="Chats"
                items={scanResult.chats}
                selectedIds={selection.chats}
                onToggleItem={(itemId, checked) => toggleCategoryItem("chats", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "chats",
                    scanResult.chats.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("chats", [])}
                getItemLabel={(item) => item.name || item.characterName}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  return (
                    <span>
                      Folder: {item.folderName} · fileName: {item.name} · characterName: {item.characterName}
                      {modified ? ` · modified ${modified}` : ""}
                    </span>
                  );
                }}
              />

              <SelectableImportCategory
                icon={<Users size="0.875rem" />}
                label="Group Chats"
                items={scanResult.groupChats}
                selectedIds={selection.groupChats}
                onToggleItem={(itemId, checked) => toggleCategoryItem("groupChats", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "groupChats",
                    scanResult.groupChats.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("groupChats", [])}
                getItemLabel={(item) => item.groupName || item.name}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  return (
                    <span>
                      {item.members.length > 0 ? item.members.join(", ") : "No linked members"}
                      {modified ? ` · modified ${modified}` : ""}
                    </span>
                  );
                }}
              />

              <SelectableImportCategory
                icon={<FileText size="0.875rem" />}
                label="Presets"
                items={scanResult.presets}
                selectedIds={selection.presets}
                onToggleItem={(itemId, checked) => toggleCategoryItem("presets", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "presets",
                    scanResult.presets.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("presets", [])}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  return (
                    <span>
                      {item.isBuiltin ? "Detected built-in preset" : "Custom or user preset"}
                      {modified ? ` · modified ${modified}` : ""}
                    </span>
                  );
                }}
                renderBadge={(item) =>
                  item.isBuiltin ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.5625rem] font-medium text-amber-400">
                      Built-in
                    </span>
                  ) : null
                }
              />

              <SelectableImportCategory
                icon={<BookOpen size="0.875rem" />}
                label="Lorebooks"
                items={scanResult.lorebooks}
                selectedIds={selection.lorebooks}
                onToggleItem={(itemId, checked) => toggleCategoryItem("lorebooks", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "lorebooks",
                    scanResult.lorebooks.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("lorebooks", [])}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  return modified ? <span>Modified {modified}</span> : null;
                }}
              />

              <SelectableImportCategory
                icon={<Image size="0.875rem" />}
                label="Backgrounds"
                items={scanResult.backgrounds}
                selectedIds={selection.backgrounds}
                onToggleItem={(itemId, checked) => toggleCategoryItem("backgrounds", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "backgrounds",
                    scanResult.backgrounds.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("backgrounds", [])}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  return modified ? <span>Modified {modified}</span> : null;
                }}
              />

              <SelectableImportCategory
                icon={<UserCircle size="0.875rem" />}
                label="Personas"
                items={scanResult.personas}
                selectedIds={selection.personas}
                onToggleItem={(itemId, checked) => toggleCategoryItem("personas", itemId, checked)}
                onSelectAll={() =>
                  updateCategorySelection(
                    "personas",
                    scanResult.personas.map((item) => item.id),
                  )
                }
                onSelectNone={() => updateCategorySelection("personas", [])}
                renderDetails={(item) => {
                  const modified = formatSTBulkModifiedAt(item.modifiedAt);
                  const description = item.description?.trim();
                  return (
                    <span>
                      {description || "No description"}
                      {modified ? ` · modified ${modified}` : ""}
                    </span>
                  );
                }}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
                <XCircle size="0.875rem" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2 max-sm:flex-col">
              <button
                onClick={reset}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--secondary)] active:scale-95"
              >
                Back
              </button>
              <button
                onClick={importSelected}
                disabled={!hasAnySelected}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all active:scale-95",
                  hasAnySelected
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
                    : "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)] opacity-60",
                )}
              >
                <Import size="0.875rem" />
                Import Selected
              </button>
            </div>
          </>
        )}

        {phase === "importing" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 size="2rem" className="animate-spin text-[var(--primary)]" />
            <p className="text-sm font-medium">Importing your data...</p>
            {progress ? (
              <div className="flex w-full flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--foreground)]">{progress.category}</span>
                  <span className="tabular-nums text-[var(--muted-foreground)]">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--secondary)]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)] transition-all duration-200"
                    style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
                  />
                </div>
                <p className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">{progress.item}</p>

                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  {progress.imported.characters > 0 && <span>{progress.imported.characters} characters</span>}
                  {progress.imported.chats > 0 && <span>{progress.imported.chats} chats</span>}
                  {progress.imported.groupChats > 0 && <span>{progress.imported.groupChats} group chats</span>}
                  {progress.imported.presets > 0 && <span>{progress.imported.presets} presets</span>}
                  {progress.imported.lorebooks > 0 && <span>{progress.imported.lorebooks} lorebooks</span>}
                  {progress.imported.backgrounds > 0 && <span>{progress.imported.backgrounds} backgrounds</span>}
                  {progress.imported.personas > 0 && <span>{progress.imported.personas} personas</span>}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">Preparing...</p>
            )}
          </div>
        )}

        {phase === "done" && importResult && (
          <>
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg p-3 text-xs",
                importResult.success
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-[var(--destructive)]/10 text-[var(--destructive)]",
              )}
            >
              {importResult.success ? <CheckCircle size="0.875rem" /> : <XCircle size="0.875rem" />}
              <span className="font-medium">
                {importResult.success ? "Import complete!" : (importResult.error ?? "Import failed")}
              </span>
            </div>

            {importResult.success && (
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  icon={<Users size="0.875rem" />}
                  label="Characters"
                  count={importResult.imported.characters}
                />
                <StatCard icon={<MessageSquare size="0.875rem" />} label="Chats" count={importResult.imported.chats} />
                <StatCard
                  icon={<Users size="0.875rem" />}
                  label="Group Chats"
                  count={importResult.imported.groupChats}
                />
                <StatCard icon={<FileText size="0.875rem" />} label="Presets" count={importResult.imported.presets} />
                <StatCard
                  icon={<BookOpen size="0.875rem" />}
                  label="Lorebooks"
                  count={importResult.imported.lorebooks}
                />
                <StatCard
                  icon={<Image size="0.875rem" />}
                  label="Backgrounds"
                  count={importResult.imported.backgrounds}
                />
                <StatCard
                  icon={<UserCircle size="0.875rem" />}
                  label="Personas"
                  count={importResult.imported.personas}
                />
              </div>
            )}

            {importResult.errors.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-amber-500/10 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                  <AlertTriangle size="0.75rem" />
                  {importResult.errors.length} warning{importResult.errors.length !== 1 ? "s" : ""}
                </div>
                <div className="max-h-24 overflow-y-auto text-[0.625rem] text-[var(--muted-foreground)]">
                  {importResult.errors.map((warning, index) => (
                    <div key={`${warning}-${index}`} className="py-0.5">
                      {warning}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleClose}
              className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 active:scale-95"
            >
              Done
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function SelectableImportCategory<T extends STBulkScanItemBase>({
  icon,
  label,
  items,
  selectedIds,
  onToggleItem,
  onSelectAll,
  onSelectNone,
  getItemLabel,
  renderDetails,
  renderBadge,
}: {
  icon: ReactNode;
  label: string;
  items: T[];
  selectedIds: string[];
  onToggleItem: (itemId: string, checked: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  getItemLabel?: (item: T) => string;
  renderDetails?: (item: T) => ReactNode;
  renderBadge?: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(items.length <= 8 && items.length > 0);
  const selectedSet = new Set(selectedIds);

  return (
    <div className="rounded-lg border border-[var(--border)]">
      <div className="flex items-center gap-2.5 p-2.5">
        <span className={cn("shrink-0 text-[var(--muted-foreground)]", items.length === 0 && "opacity-40")}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">
              {label}{" "}
              <span className={cn("text-[var(--muted-foreground)]", items.length === 0 && "opacity-40")}>
                ({selectedIds.length}/{items.length})
              </span>
            </span>
          </div>
        </div>
        {items.length > 0 && (
          <>
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded-md px-2 py-1 text-[0.625rem] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--accent)]"
            >
              All
            </button>
            <button
              type="button"
              onClick={onSelectNone}
              className="rounded-md px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              None
            </button>
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="rounded-md px-2 py-1 text-[0.625rem] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--accent)]"
            >
              {expanded ? "Hide" : "Show"}
            </button>
          </>
        )}
      </div>

      {expanded && items.length > 0 && (
        <div className="max-h-60 space-y-1 overflow-y-auto border-t border-[var(--border)] px-2.5 py-2">
          {items.map((item) => {
            const checked = selectedSet.has(item.id);
            return (
              <label
                key={item.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--secondary)]/70",
                  checked && "bg-[var(--primary)]/6",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggleItem(item.id, e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium">
                      {getItemLabel ? getItemLabel(item) : item.name}
                    </span>
                    {renderBadge?.(item)}
                    {checked && (
                      <span className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-[var(--primary)]">
                        <span className="inline-flex items-center gap-1">
                          <Check size="0.5625rem" />
                          Selected
                        </span>
                      </span>
                    )}
                  </div>
                  {renderDetails && (
                    <div className="truncate text-[0.625rem] text-[var(--muted-foreground)]">{renderDetails(item)}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] p-2.5">
      <span className="text-[var(--primary)]">{icon}</span>
      <div className="flex flex-col">
        <span className="text-sm font-bold">{count}</span>
        <span className="text-[0.625rem] text-[var(--muted-foreground)]">{label}</span>
      </div>
    </div>
  );
}
