import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { userFacingError } from "../../../../engine/shared/user-facing-error";
import { isRecord } from "../../../../engine/shared/value-readers";
import { toUserMessage } from "../../../../shared/lib/error-message";
import {
  readBrowserSettings,
  saveLogin,
  saveProviderNsfw,
  type BrowserSettings,
  type LoginProviderId,
} from "../lib/browser-settings";
import { providerById } from "../lib/providers";
import type { BrowserProvider, ProviderId } from "../lib/providers/types";
import { siteGet, sitePost } from "../lib/site-api";

/** The providers whose session is checked when the Browser opens, in the order the checks go out. */
const SESSION_CHECK_ORDER: LoginProviderId[] = ["pygmalion", "chartavern"];

function isLoginProvider(id: ProviderId): id is LoginProviderId {
  return id === "pygmalion" || id === "chartavern";
}

/** A value the site's login route refused comes back as an invalid-input command error whose message says why. */
function refusedValueError(error: unknown): unknown {
  const details = isRecord(error) ? error.details : undefined;
  if (error instanceof Error && isRecord(details) && details.code === "invalid_input" && error.message) {
    return userFacingError(error.message);
  }
  return error;
}

/**
 * The saved browser settings (NSFW per provider, login flags) and the Pygmalion and CharacterTavern logins: the
 * session check once per mount, Save & connect, and log out.
 */
export function useBrowserLogins({ onAccountChanged }: { onAccountChanged: (provider: ProviderId) => void }) {
  const [settings, setSettings] = useState<BrowserSettings>(() => readBrowserSettings());
  const [busy, setBusy] = useState(false);
  const onAccountChangedRef = useRef(onAccountChanged);
  onAccountChangedRef.current = onAccountChanged;

  useEffect(() => {
    for (const id of SESSION_CHECK_ORDER) {
      const provider = providerById(id);
      const login = provider.login;
      if (!login) continue;
      siteGet<unknown>(login.sessionPath).then(
        (reply) => {
          const active = isRecord(reply) && reply.active === true;
          const saved = readBrowserSettings().logins[id] === true;
          if (active && !saved) setSettings(saveLogin(id, true));
          if (!active && saved) {
            setSettings(saveLogin(id, false));
            toast.warning(`${provider.name} session expired — please log in again.`);
          }
        },
        (error: unknown) => {
          // A failed check says nothing about the session, so the saved flag stays as it is (decision 7).
          console.warn(`[bot-browser] Couldn't check the ${provider.name} session.`, error);
        },
      );
    }
  }, []);

  const setNsfw = useCallback((provider: ProviderId, nsfw: boolean) => {
    setSettings(saveProviderNsfw(provider, nsfw));
  }, []);

  const logIn = useCallback(async (provider: BrowserProvider, value: string): Promise<boolean> => {
    const login = provider.login;
    if (!login || !isLoginProvider(provider.id)) return false;
    const isToken = login.kind === "token";
    setBusy(true);
    try {
      let saved: unknown;
      try {
        saved = await sitePost<unknown>(login.savePath, isToken ? { token: value } : { cookie: value });
      } catch (error) {
        throw refusedValueError(error);
      }
      if (!isRecord(saved) || !saved.ok) {
        const reason = isRecord(saved) && typeof saved.error === "string" && saved.error ? saved.error : null;
        throw userFacingError(reason ?? (isToken ? "Failed to save token" : "Failed to save cookie"));
      }
      const check = await siteGet<unknown>(login.validatePath);
      if (!isRecord(check) || check.valid !== true) {
        const reason = isRecord(check) && typeof check.reason === "string" && check.reason ? check.reason : null;
        throw userFacingError(reason ?? (isToken ? "Token validation failed" : "Cookie validation failed"));
      }
      setSettings(saveLogin(provider.id, true, true));
      onAccountChangedRef.current(provider.id);
      const nsfwWord = !isToken && check.hasNsfw === true ? "detected" : "enabled";
      toast.success(`Logged in to ${provider.name}! NSFW content ${nsfwWord}.`);
      return true;
    } catch (error) {
      toast.error(
        toUserMessage(error, {
          fallback: `Couldn't log in to ${provider.name}. Check your internet connection, then try again.`,
        }),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const logOut = useCallback(async (provider: BrowserProvider) => {
    const login = provider.login;
    if (!login || !isLoginProvider(provider.id)) return;
    setBusy(true);
    try {
      await sitePost<unknown>(login.logoutPath);
      setSettings(saveLogin(provider.id, false, false));
      onAccountChangedRef.current(provider.id);
      toast.success(`Logged out of ${provider.name}.`);
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: `Couldn't log out of ${provider.name}. Try again.` }));
    } finally {
      setBusy(false);
    }
  }, []);

  const isLoggedIn = (provider: BrowserProvider) =>
    isLoginProvider(provider.id) && settings.logins[provider.id] === true;

  return { settings, busy, setNsfw, logIn, logOut, isLoggedIn };
}
