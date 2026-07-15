import { useState } from "react";
import { themesApi } from "../shared/api/customization-api";
import { normalAppUrl } from "./customization-safe-mode";
import { extensionDeviceConsentStore } from "../shared/lib/extension-device-consent";

export function CustomizationSafeMode() {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const disableCustomizations = async () => {
    setStatus("working");
    setMessage("");
    let consentError: unknown = null;
    let themeError: unknown = null;
    try {
      extensionDeviceConsentStore.clearAll();
    } catch (error) {
      consentError = error;
    }
    try {
      await themesApi.setActive(null);
    } catch (error) {
      themeError = error;
    }
    if (!consentError && !themeError) {
      setStatus("done");
      setMessage("The active custom theme and this device's extension activations are disabled.");
      return;
    }
    setStatus("error");
    if (!consentError) {
      setMessage(
        "This device's extension activations were disabled, but the active theme could not be disabled. Check the runtime connection and try again.",
      );
    } else if (!themeError) {
      setMessage(
        "The active theme was disabled, but this device's extension activations could not be cleared. Check browser storage access and try again.",
      );
    } else {
      setMessage(
        "Neither the active theme nor this device's extension activations could be disabled. Check runtime and browser storage access, then try again.",
      );
    }
  };

  return (
    <main className="min-h-screen bg-[#08111f] px-4 py-10 text-slate-100" data-component="CustomizationSafeMode">
      <section className="mx-auto flex max-w-lg flex-col gap-4 rounded-2xl border border-sky-300/20 bg-[#101c2d] p-6 shadow-2xl">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">De-Koi recovery</div>
        <h1 className="text-2xl font-semibold">Customization safe mode</h1>
        <p className="text-sm leading-6 text-slate-300">
          Custom themes and extensions are not loaded on this page. Disable them here if a customization made the normal
          interface hard to use.
        </p>
        <button
          type="button"
          onClick={() => void disableCustomizations()}
          disabled={status === "working"}
          className="rounded-lg bg-sky-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-60"
        >
          {status === "working" ? "Disabling customizations…" : "Disable customizations"}
        </button>
        {message && (
          <p role="status" className={status === "error" ? "text-sm text-rose-300" : "text-sm text-emerald-300"}>
            {message}
          </p>
        )}
        <a
          className="text-center text-sm text-sky-300 underline-offset-4 hover:underline"
          href={normalAppUrl(window.location.href)}
        >
          Return to De-Koi
        </a>
      </section>
    </main>
  );
}
