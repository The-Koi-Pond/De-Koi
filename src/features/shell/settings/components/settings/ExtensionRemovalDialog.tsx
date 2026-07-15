import type { InstalledExtension } from "../../../../../engine/contracts/types/extension";

export function ExtensionRemovalDialog({
  extension,
  pending,
  onCancel,
  onRemove,
}: {
  extension: InstalledExtension;
  pending: boolean;
  onCancel: () => void;
  onRemove: (policy: "retain" | "purge") => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="extension-removal-title" className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h2 id="extension-removal-title" className="text-sm font-semibold">Remove {extension.name}?</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          You can keep its local extension data for a later reinstall, or permanently remove the extension and its data.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={pending} onClick={onCancel} className="rounded-lg px-3 py-2 text-xs">Cancel</button>
          <button disabled={pending} onClick={() => onRemove("retain")} className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs">
            Remove extension
          </button>
          <button disabled={pending} onClick={() => onRemove("purge")} className="rounded-lg bg-[var(--destructive)] px-3 py-2 text-xs text-white">
            Remove extension and its data
          </button>
        </div>
      </div>
    </div>
  );
}
