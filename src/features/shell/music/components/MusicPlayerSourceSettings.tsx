import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, LogIn, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

import { openExternalUrl } from "../../../../shared/api/external-link-api";
import {
  musicApi,
  spotifyMusicApi,
  type MusicPlayerSettings,
  type MusicPlayerSettingsUpdate,
  type MusicPlayerSource,
  type SpotifyStatus,
} from "../../../../shared/api/music-api";
import {
  musicPlayerSettingsQueryKey,
  useMusicPlayerSettings,
} from "../../../../shared/hooks/use-music-player-settings";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { cn } from "../../../../shared/lib/utils";

const SPOTIFY_STATUS_KEY = ["music", "spotify", "status"] as const;
const SPOTIFY_DEVICES_KEY = ["music", "spotify", "devices"] as const;
const SIGN_IN_POLL_MS = 2_000;
const SIGN_IN_WAIT_MS = 10 * 60_000;
const SIGN_IN_EXPIRED_MESSAGE = "This sign-in has expired or was already used. Press Connect to try again.";

const PRIMARY_BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50";
const INPUT =
  "w-full rounded-lg bg-[var(--card)] px-3 py-2 text-xs ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

type PendingSignIn = { signInId: string; authUrl: string; stopAt: number; browserOpenFailed: boolean };

/** Source choice and Spotify connection for the Music Player module. */
export function MusicPlayerSourceSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useMusicPlayerSettings();
  const settings = settingsQuery.data;
  const spotifySelected = settings?.source === "spotify";
  const statusQuery = useQuery({
    queryKey: SPOTIFY_STATUS_KEY,
    queryFn: () => spotifyMusicApi.status(),
    enabled: spotifySelected,
  });
  const status = statusQuery.data;
  const devicesQuery = useQuery({
    queryKey: SPOTIFY_DEVICES_KEY,
    queryFn: () => spotifyMusicApi.devices(),
    enabled: spotifySelected && status?.connected === true,
  });
  const [clientIdDraft, setClientIdDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSignIn | null>(null);
  const [callbackDraft, setCallbackDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const clientId = (clientIdDraft ?? settings?.spotifyClientId ?? "").trim();
  const redirectUri = status?.redirectUri || settings?.spotifyRedirectUri || "";

  function showStatus(next: SpotifyStatus) {
    queryClient.setQueryData(SPOTIFY_STATUS_KEY, next);
    void queryClient.invalidateQueries({ queryKey: SPOTIFY_DEVICES_KEY });
  }

  async function saveSettings(patch: MusicPlayerSettingsUpdate) {
    setNotice(null);
    try {
      const next = await musicApi.updateSettings(patch);
      queryClient.setQueryData<MusicPlayerSettings>(musicPlayerSettingsQueryKey, next);
      void queryClient.invalidateQueries({ queryKey: SPOTIFY_STATUS_KEY });
    } catch (error) {
      setNotice(toUserMessage(error, { fallback: "Couldn't save the Music Player settings. Try again." }));
    }
  }

  async function connect() {
    if (!clientId) return;
    setWorking(true);
    setNotice(null);
    setCallbackDraft("");
    try {
      const start = await spotifyMusicApi.startSignIn(clientId);
      setClientIdDraft(null);
      void queryClient.invalidateQueries({ queryKey: musicPlayerSettingsQueryKey });
      let browserOpenFailed = false;
      try {
        await openExternalUrl(start.authUrl);
      } catch (error) {
        console.warn("[music] Couldn't open the Spotify sign-in page", error);
        browserOpenFailed = true;
      }
      setPending({
        signInId: start.signInId,
        authUrl: start.authUrl,
        stopAt: Date.now() + Math.min(start.expiresInMs, SIGN_IN_WAIT_MS),
        browserOpenFailed,
      });
    } catch (error) {
      setNotice(toUserMessage(error, { fallback: "Couldn't start the Spotify sign-in. Try again." }));
    } finally {
      setWorking(false);
    }
  }

  async function finishWithAddress() {
    const address = callbackDraft.trim();
    if (!address) return;
    setWorking(true);
    setNotice(null);
    try {
      showStatus(await spotifyMusicApi.finishSignIn(address));
      setPending(null);
      setCallbackDraft("");
    } catch (error) {
      setNotice(toUserMessage(error, { fallback: "Couldn't finish the Spotify sign-in. Press Connect to try again." }));
    } finally {
      setWorking(false);
    }
  }

  async function disconnect() {
    setWorking(true);
    setNotice(null);
    try {
      showStatus(await spotifyMusicApi.disconnect());
      setPending(null);
    } catch (error) {
      setNotice(toUserMessage(error, { fallback: "Couldn't disconnect Spotify. Try again." }));
    } finally {
      setWorking(false);
    }
  }

  // Wait for the browser sign-in: ask every 2 s, and stop after 10 minutes.
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (Date.now() >= pending.stopAt) {
        setPending(null);
        setNotice(SIGN_IN_EXPIRED_MESSAGE);
        return;
      }
      spotifyMusicApi.signInStatus(pending.signInId).then(
        (result) => {
          if (cancelled || result.status === "waiting") return;
          setPending(null);
          if (result.status === "done") {
            void queryClient.invalidateQueries({ queryKey: SPOTIFY_STATUS_KEY });
            void queryClient.invalidateQueries({ queryKey: SPOTIFY_DEVICES_KEY });
          } else {
            setNotice(result.message);
          }
        },
        (error: unknown) => {
          if (cancelled) return;
          setPending(null);
          setNotice(toUserMessage(error, { fallback: SIGN_IN_EXPIRED_MESSAGE }));
        },
      );
    }, SIGN_IN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pending, queryClient]);

  if (settingsQuery.isError) {
    return (
      <p role="alert" className="text-xs text-[var(--destructive)]">
        {toUserMessage(settingsQuery.error, { fallback: "Couldn't load the Music Player settings. Try again." })}
      </p>
    );
  }
  if (!settings) {
    return <p className="text-xs text-[var(--muted-foreground)]">Loading Music Player settings...</p>;
  }

  const devices = devicesQuery.data?.devices ?? [];
  const preferredMissing =
    !!settings.spotifyPreferredDeviceId && !devices.some((device) => device.id === settings.spotifyPreferredDeviceId);

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Music source
        </legend>
        {(
          [
            ["youtube", "YouTube", "Searches YouTube and plays inside De-Koi. Nothing to set up."],
            ["spotify", "Spotify", "Plays your Spotify music on one of your Spotify devices."],
          ] as const satisfies ReadonlyArray<readonly [MusicPlayerSource, string, string]>
        ).map(([value, label, help]) => (
          <label key={value} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="radio"
              name="music-player-source"
              value={value}
              checked={settings.source === value}
              onChange={() => void saveSettings({ source: value })}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-[var(--foreground)]">{label}</span>
              <span className="block text-[var(--muted-foreground)]">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {spotifySelected && (
        <div className="flex flex-col gap-3 rounded-lg bg-[var(--secondary)]/50 p-3 ring-1 ring-[var(--border)]">
          <div className="space-y-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
            <p>
              Spotify needs your own Spotify developer app. In the Spotify Developer Dashboard, create an app that uses
              the Web API, add the redirect URI below to it, then paste the app&apos;s Client ID here.
            </p>
            <p>Playback control needs Spotify Premium. Searching and reading your library work without it.</p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--foreground)]">Redirect URI to register</span>
            <code className="select-all break-all rounded-md bg-[var(--card)] px-2 py-1.5 font-mono text-[0.6875rem] text-[var(--foreground)] ring-1 ring-[var(--border)]">
              {redirectUri}
            </code>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--foreground)]">Client ID</span>
            <input
              value={clientIdDraft ?? settings.spotifyClientId}
              onChange={(event) => setClientIdDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your Spotify app's Client ID"
              className={INPUT}
            />
          </label>

          <SpotifyConnectionStatus status={status} loading={statusQuery.isLoading} />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!clientId || working}
              className={PRIMARY_BUTTON}
            >
              {working ? <Loader2 size="0.8125rem" className="animate-spin" /> : <LogIn size="0.8125rem" />}
              {status?.connected ? "Reconnect" : "Connect"}
            </button>
            {status?.connected && (
              <button type="button" onClick={() => void disconnect()} disabled={working} className={SECONDARY_BUTTON}>
                <Unplug size="0.8125rem" />
                Disconnect
              </button>
            )}
          </div>

          {pending && (
            <div className="flex flex-col gap-2 rounded-lg bg-[var(--card)] p-2.5 ring-1 ring-[var(--border)]">
              <p className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
                <Loader2 size="0.8125rem" className="shrink-0 animate-spin text-[var(--primary)]" />
                {pending.browserOpenFailed
                  ? "Your browser didn't open. Use the link below to sign in to Spotify."
                  : "Finish signing in to Spotify in your browser. This updates by itself."}
              </p>
              <a
                href={pending.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(SECONDARY_BUTTON, "self-start")}
              >
                <ExternalLink size="0.75rem" />
                Open the Spotify sign-in page
              </a>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[var(--foreground)]">
                  Browser couldn&apos;t reach the callback? Paste the address here.
                </span>
                <div className="flex gap-1.5">
                  <input
                    value={callbackDraft}
                    onChange={(event) => setCallbackDraft(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={redirectUri ? `${redirectUri}?code=...` : "The full address from your browser"}
                    className={INPUT}
                  />
                  <button
                    type="button"
                    onClick={() => void finishWithAddress()}
                    disabled={!callbackDraft.trim() || working}
                    className={SECONDARY_BUTTON}
                  >
                    Finish
                  </button>
                </div>
              </label>
            </div>
          )}

          {status?.connected && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--foreground)]">Preferred device</span>
              <div className="flex gap-1.5">
                <select
                  value={settings.spotifyPreferredDeviceId ?? ""}
                  onChange={(event) => {
                    const device = devices.find((entry) => entry.id === event.target.value) ?? null;
                    void saveSettings({
                      spotifyPreferredDeviceId: device?.id ?? null,
                      spotifyPreferredDeviceName: device?.name ?? null,
                    });
                  }}
                  aria-label="Preferred Spotify device"
                  className={INPUT}
                >
                  <option value="">No preferred device</option>
                  {preferredMissing && (
                    <option value={settings.spotifyPreferredDeviceId ?? ""}>
                      {settings.spotifyPreferredDeviceName || "Saved device"} (not open right now)
                    </option>
                  )}
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                      {device.isActive ? " (active)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void devicesQuery.refetch()}
                  disabled={devicesQuery.isFetching}
                  aria-label="Refresh Spotify devices"
                  title="Refresh Spotify devices"
                  className={SECONDARY_BUTTON}
                >
                  <RefreshCw size="0.8125rem" className={cn(devicesQuery.isFetching && "animate-spin")} />
                </button>
              </div>
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                {devicesQuery.isError
                  ? toUserMessage(devicesQuery.error, { fallback: "Couldn't list your Spotify devices. Try again." })
                  : "Used when no Spotify device is playing or active. Spotify lists a device only while the app is open on it."}
              </p>
            </div>
          )}
        </div>
      )}

      {notice && (
        <p role="alert" className="text-xs text-[var(--destructive)]">
          {notice}
        </p>
      )}
    </div>
  );
}

function SpotifyConnectionStatus({ status, loading }: { status: SpotifyStatus | undefined; loading: boolean }) {
  if (loading) return <p className="text-xs text-[var(--muted-foreground)]">Checking the Spotify connection...</p>;
  if (!status?.connected) return <p className="text-xs text-[var(--muted-foreground)]">Not connected to Spotify.</p>;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
        <CheckCircle2 size="0.875rem" className="shrink-0 text-emerald-500" />
        {status.renewsAutomatically ? "Connected (renews automatically)" : "Connected to Spotify"}
      </p>
      {status.displayName && <p className="text-[var(--muted-foreground)]">Signed in as {status.displayName}.</p>}
      {status.missingScopes.length > 0 && (
        <p role="alert" className="text-[var(--destructive)]">
          This sign-in is missing Spotify permissions some features need ({status.missingScopes.join(", ")}). Press
          Reconnect and allow them.
        </p>
      )}
    </div>
  );
}
