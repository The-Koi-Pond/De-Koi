import type { InstalledExtension } from "../../../../../engine/contracts/types/extension";
import type { ExtensionDeviceConsent } from "../../../../../shared/lib/extension-device-consent";
import { extensionCapabilityView } from "../../lib/extension-capability-view";

export function ExtensionActivationDialog({
  extension,
  compatibility,
  canActivate,
  consent,
  onCancel,
  onActivate,
  onRevoke,
}: {
  extension: InstalledExtension;
  compatibility: "compatible" | "incompatible" | "not-declared";
  canActivate: boolean;
  consent: ExtensionDeviceConsent | null;
  onCancel: () => void;
  onActivate: (activation: { css: boolean; javascript: boolean }) => void;
  onRevoke: () => void;
}) {
  const capabilities = extensionCapabilityView(extension);
  const hasCss = Boolean(extension.css?.trim());
  const hasJavaScript = Boolean(extension.js?.trim());
  const blocked = !canActivate;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="extension-activation-title" className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
        <h2 id="extension-activation-title" className="text-sm font-semibold">Device access for {extension.name}</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          JavaScript extensions run as trusted page-level code. Manifest permissions limit De-Koi-provided helpers, not direct browser-page access.
        </p>
        {blocked && (
          <p className="text-xs text-[var(--destructive)]">
            {compatibility === "not-declared"
              ? "Package extensions must declare a compatible De-Koi version range."
              : "This package is incompatible with this De-Koi version."}
          </p>
        )}
        <ul className="space-y-1 text-[0.6875rem]">
          {capabilities.map((capability) => (
            <li key={capability.permission}>{capability.label} — {capability.status}</li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-2 text-xs">Cancel</button>
          {consent && <button onClick={onRevoke} className="rounded-lg px-3 py-2 text-xs text-[var(--destructive)]">Deactivate on this device</button>}
          <button
            disabled={blocked || (!hasCss && !hasJavaScript)}
            onClick={() => onActivate({ css: hasCss, javascript: hasJavaScript })}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs text-[var(--primary-foreground)] disabled:opacity-50"
          >
            Activate on this device
          </button>
        </div>
      </div>
    </div>
  );
}
