import { Cookie, KeyRound, Loader2 } from "lucide-react";
import { useId, useState } from "react";

import { Modal } from "../../../../../shared/components/ui/Modal";
import type { BrowserProvider } from "../../lib/providers/types";

interface LoginCopy {
  title: string;
  secondNote: string;
  fieldLabel: string;
  placeholder: string;
  helpSummary: string;
  site: string;
  siteUrl: string;
  storageStep: string;
  findStep: string;
  copyStep: string;
  activeNote: string;
  linkLabel: string;
}

const TOKEN_COPY: LoginCopy = {
  title: "Pygmalion authentication",
  secondNote: "Optional: Paste your auth token to enable NSFW content and access authenticated character data.",
  fieldLabel: "Auth token",
  placeholder: "Paste your Pygmalion auth token here",
  helpSummary: "How to get your auth token",
  site: "pygmalion.chat",
  siteUrl: "https://pygmalion.chat",
  storageStep: "Open DevTools (F12) → Application tab → Local Storage",
  findStep: "Find the entry named",
  copyStep: "Copy its Value (a long string, ~705 characters) and paste it above.",
  activeNote: "Token active — NSFW content enabled",
  linkLabel: "Website",
};

const COOKIE_COPY: LoginCopy = {
  title: "CharacterTavern session",
  secondNote: "Optional: Paste your session cookies to see NSFW-tagged content.",
  fieldLabel: "Cookie string",
  placeholder: "Paste your session cookie value here",
  helpSummary: "How to get your session cookie",
  site: "character-tavern.com",
  siteUrl: "https://character-tavern.com",
  storageStep: "Open DevTools (F12) → Application tab → Cookies",
  findStep: "Find the cookie named",
  copyStep: "Copy its Value and paste it above.",
  activeNote: "Session active — NSFW content enabled",
  linkLabel: "CharacterTavern",
};

/** The Pygmalion token or CharacterTavern cookie dialog. Rust stores what's pasted; the screen never reads it back. */
export function LoginDialog({
  provider,
  loggedIn,
  busy,
  onClose,
  onSave,
  onLogOut,
  onOpenLink,
}: {
  provider: BrowserProvider;
  loggedIn: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  onLogOut: () => void;
  onOpenLink: (url: string) => void;
}) {
  const [value, setValue] = useState("");
  const fieldId = useId();
  const isToken = provider.login?.kind === "token";
  const copy = isToken ? TOKEN_COPY : COOKIE_COPY;
  const Icon = isToken ? KeyRound : Cookie;
  const keyName = isToken ? "authn" : "session";

  const siteLink = (label: string) => (
    <a
      href={copy.siteUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        onOpenLink(copy.siteUrl);
      }}
      className="text-[var(--primary)] underline-offset-2 hover:underline"
    >
      {label}
    </a>
  );

  return (
    <Modal open onClose={onClose} title={copy.title}>
      <div className="space-y-4 text-sm text-[var(--foreground)]">
        <div className="flex items-start gap-3">
          <Icon size="1.25rem" aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--primary)]" />
          <div className="space-y-2">
            <p>Browsing and downloading public characters works without logging in!</p>
            <p className="text-[var(--muted-foreground)]">{copy.secondNote}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={fieldId} className="text-xs font-semibold text-[var(--muted-foreground)]">
            {copy.fieldLabel}
          </label>
          <textarea
            id={fieldId}
            rows={3}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={loggedIn || busy}
            placeholder={copy.placeholder}
            className="w-full resize-none rounded-md border border-[var(--input)] bg-[var(--secondary)] p-2.5 font-mono text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60"
          />
        </div>

        <details className="rounded-md border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-xs font-semibold">{copy.helpSummary}</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--muted-foreground)]">
            <li>Go to {siteLink(copy.site)} and log in</li>
            <li>{copy.storageStep}</li>
            <li>
              {copy.findStep} <code className="font-mono">{keyName}</code>
            </li>
            <li>{copy.copyStep}</li>
          </ol>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {siteLink(copy.linkLabel)}
          {loggedIn ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-emerald-500">{copy.activeNote}</span>
              <button
                type="button"
                onClick={onLogOut}
                disabled={busy}
                className="h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--accent)] disabled:opacity-60"
              >
                Log out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onSave(value)}
              disabled={busy || value.trim() === ""}
              className="flex h-8 items-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />}
              Save & connect
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
